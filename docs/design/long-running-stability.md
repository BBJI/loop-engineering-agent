# 补充设计：长时间运行稳定性保障

## 心跳与监控机制（R-004 修复）

### 心跳机制

```typescript
interface Heartbeat {
  timestamp: number;          // 心跳时间
  phase: string;              // 当前阶段
  task_id?: string;           // 当前任务
  memory_usage_mb: number;    // 内存使用
  context_usage_pct: number;  // 上下文使用率
  model_calls_total: number;  // 累计模型调用次数
  elapsed_seconds: number;    // 运行时长
}
```

- 每 60 秒写入心跳到 `.lea/state/heartbeat.json`
- 心跳包含运行状态快照，用于崩溃后判断中断点
- 心跳超时（180 秒无更新）标记为异常中断

### 内存水位检测

```typescript
const MEMORY_THRESHOLDS = {
  warning: 512,    // MB — 开始 GC
  critical: 768,   // MB — 强制压缩 + GC
  fatal: 1024,     // MB — 保存检查点并优雅退出
};
```

- 每 30 秒检测 Node.js 进程内存占用（`process.memoryUsage()`）
- 超过 warning：触发压缩器和垃圾回收
- 超过 critical：强制上下文压缩 + 释放子代理资源
- 超过 fatal：保存当前检查点，输出内存溢出报告，优雅退出（可 resume）

### 自动垃圾回收策略

1. **子代理资源释放**：子代理完成后立即销毁 Worker，释放其独立堆内存
2. **历史消息裁剪**：超过当前阶段范围的消息从内存中移除（已持久化到磁盘）
3. **文件内容缓存 LRU**：子代理读取的文件内容缓存采用 LRU 策略，最大 50 条

### 检查点自动保存

- 阶段完成时自动保存
- 每个任务完成时自动保存
- 内存超过 warning 阈值时主动保存
- 每 10 分钟定时保存（兜底）

### 崩溃恢复流程

1. 启动时检查 `.lea/state/heartbeat.json`
2. 如果心跳超时（> 180 秒），标记为异常中断
3. 加载最近的检查点文件
4. 验证检查点完整性（schema 校验）
5. 从检查点恢复状态机
6. 重新执行检查点之后的未完成任务（子代理级别重做）

### 长时间运行仪表盘

在 `--verbose` 模式下，终端顶部持续显示：

```
LEA | 运行 2h15m | 内存 412MB | 上下文 45% | 模型调用 127次 | 成本 $1.23
```
