# 补充设计：子代理通信协议

## 消息协议（R-002 修复）

### 主控 → 子代理：任务请求

```typescript
interface SubAgentRequest {
  task_id: string;              // 任务 ID
  task_description: string;    // 任务描述（来自 task-allocation）
  skill_name: string;          // 要执行的技能名（如 'dev-skill'）
  skill_content: string;       // SKILL.md 内容（注入到子代理 prompt）

  // 上下文注入（摘要，非完整历史）
  context: {
    requirement_summary: PhaseSummary;   // 需求阶段摘要
    design_summary: PhaseSummary;        // 设计阶段摘要
    review_summary?: PhaseSummary;       // 评估阶段摘要（如有）
    task_breakdown?: TaskDefinition;     // 当前任务定义
  };

  // 相关文件内容（按需加载，不全量传入）
  files: {
    path: string;               // 文件路径
    content: string;            // 文件内容
  }[];

  // 权限配置（子代理继承主控权限）
  permissions: PermissionConfig;

  // 约束
  constraints: {
    max_tokens: number;         // 最大 token 预算
    max_retries: number;        // 最大重试次数
    timeout_ms: number;         // 超时时间
  };
}
```

### 子代理 → 主控：任务结果

```typescript
interface SubAgentResult {
  task_id: string;
  status: 'completed' | 'failed' | 'timeout';

  // 结果摘要（主控将此合并到上下文中，而非完整交互）
  summary: {
    description: string;         // 一句话结果描述
    files_modified: string[];    // 修改的文件列表
    files_created: string[];     // 新增的文件列表
    files_deleted: string[];     // 删除的文件列表
    tests_passed: number;        // 通过的测试数
    tests_failed: number;        // 失败的测试数
  };

  // 错误信息（仅在失败时）
  error?: {
    type: 'model_error' | 'execution_error' | 'timeout' | 'permission_denied';
    message: string;
    retry_count: number;
  };

  // 审计记录
  audit: {
    model_calls: number;         // 模型调用次数
    total_tokens: number;        // 总 token 消耗
    total_cost: number;          // 总成本
    duration_ms: number;         // 执行时长
  };
}
```

## 子代理隔离方案（R-003 修复）

### 方案选型：Worker Threads + 消息传递

**选择理由**：
- Worker Threads 是 Node.js 原生支持，无需额外依赖
- 共享文件系统访问（无需额外的文件传输机制）
- 内存隔离（每个 Worker 有独立堆，上下文天然隔离）
- 通信开销低（postMessage 序列化）
- 支持结构化克隆（可直接传递对象，无需 JSON 字符串化）

**不选子进程的原因**：启动开销大；需要额外的 IPC 通道管理；文件系统需要锁机制

**不选内存隔离的原因**：同一进程内的内存隔离无法防止上下文意外泄露到 LLM 调用中

### 架构图

```
┌─────────────────────────────────────────┐
│              主控线程                    │
│  ┌─────────┐  ┌──────────┐  ┌────────┐ │
│  │状态机    │  │压缩器    │  │权限管理│ │
│  └────┬────┘  └────┬─────┘  └───┬────┘ │
│       │            │            │       │
│       ▼            ▼            ▼       │
│  ┌──────────────────────────────────┐   │
│  │        子代理调度器               │   │
│  │  postMessage / onMessage         │   │
│  └──────┬──────┬──────┬────────────┘   │
│         │      │      │                 │
└─────────┼──────┼──────┼─────────────────┘
          │      │      │
     ┌────▼──┐ ┌▼────┐ ┌▼────┐
     │Worker │ │Worker│ │Worker│  (子代理)
     │Task-1 │ │Task-2│ │Task-3│
     │LLM调用│ │LLM调用│ │LLM调用│
     │独立上下│ │独立上下│ │独立上下│
     └───────┘ └─────┘ └─────┘
```

### 通信流程

1. 主控通过 `worker.postMessage(request)` 发送任务
2. 子代理 Worker 接收请求，注入上下文到 LLM 会话
3. 子代理独立执行，可读取共享文件系统
4. 子代理完成后通过 `parentPort.postMessage(result)` 返回摘要
5. 主控接收摘要，更新状态机，销毁 Worker

### 生命周期管理

```typescript
class SubAgentManager {
  private workers: Map<string, Worker> = new Map();

  async executeTask(request: SubAgentRequest): Promise<SubAgentResult> {
    const worker = new Worker('./sub-agent-worker.js', {
      workerData: request,
    });

    this.workers.set(request.task_id, worker);

    // 超时处理
    const timeout = setTimeout(() => {
      worker.terminate();
    }, request.constraints.timeout_ms);

    return new Promise((resolve) => {
      worker.on('message', (result: SubAgentResult) => {
        clearTimeout(timeout);
        this.workers.delete(request.task_id);
        worker.terminate();
        resolve(result);
      });

      worker.on('error', (err) => {
        clearTimeout(timeout);
        this.workers.delete(request.task_id);
        resolve({
          task_id: request.task_id,
          status: 'failed',
          summary: { description: `Worker error: ${err.message}` },
          error: { type: 'execution_error', message: err.message, retry_count: 0 },
          audit: { model_calls: 0, total_tokens: 0, total_cost: 0, duration_ms: 0 },
        });
      });
    });
  }
}
```
