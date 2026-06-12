# 补充设计：上下文压缩摘要 Schema

## 压缩摘要结构（R-001 修复）

每个阶段完成后，上下文压缩器将该阶段的详细交互压缩为以下结构化摘要：

```typescript
interface PhaseSummary {
  phase: 'req' | 'design' | 'review' | 'task' | 'dev' | 'test';
  version: string;           // schema 版本
  completed_at: string;      // ISO 时间戳

  // 阶段产出物索引（不在摘要中存储完整内容，仅索引）
  artifacts: {
    path: string;            // 文件路径（相对于项目根目录）
    type: 'document' | 'code' | 'test' | 'config';
    description: string;     // 一句话描述
  }[];

  // 关键决策摘要（从详细交互中提取）
  key_decisions: {
    decision: string;        // 决策内容
    rationale: string;       // 理由
    requirement_ref: string; // 需求引用 (FR-xxx/NFR-xxx)
  }[];

  // 待决问题（尚未解决的）
  open_issues: {
    id: string;              // 问题 ID
    description: string;     // 问题描述
    impact: string;          // 不解决的后果
    status: 'pending' | 'deferred';
  }[];

  // 与下游阶段的关键接口
  downstream_handoff: {
    phase: string;           // 下游阶段名
    inputs: string[];        // 下游阶段需要的输入摘要
    constraints: string[];   // 下游阶段必须遵守的约束
  };

  // 上下文统计（用于监控压缩效果）
  stats: {
    original_tokens: number;     // 压缩前 token 数
    compressed_tokens: number;   // 压缩后 token 数
    compression_ratio: number;   // 压缩比
    model_used: string;          // 执行压缩的模型
  };
}
```

## 压缩策略

1. **压缩触发条件**：
   - 阶段完成时自动触发（边界压缩）
   - 上下文使用率超过 80% 时紧急触发

2. **压缩模型选择**：压缩操作**强制使用高能力模型**（不受 routing 规则影响），确保摘要质量

3. **压缩后验证**：压缩后自动检查摘要是否包含下游阶段所需的关键信息（downstream_handoff），缺失则补充

4. **原始数据保留**：完整交互历史保存到 `.lea/state/phase-{name}-history.jsonl`，可通过 `lea history <phase>` 查看
