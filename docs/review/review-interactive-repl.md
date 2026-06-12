# LEA 交互式 REPL — 实现评估报告

## 1. 需求维度评审

### 可行性：✅ 全部可行

| 需求 | 可行性 | 风险 | 备注 |
|------|--------|------|------|
| FR-101 REPL 主循环 | ✅ 高 | 低 | Node.js readline 成熟可靠 |
| FR-102 工作流内监控 | ✅ 高 | 中 | AutonomousLoop 需改为异步可中断 |
| FR-103 运行时模型切换 | ✅ 高 | 低 | LLMClient 改动最小 |
| FR-104 运行时配置调整 | ✅ 高 | 低 | Config 对象引用传递，修改即生效 |
| FR-105 交互式权限确认 | ✅ 高 | 低 | inquirer 已在依赖中 |
| FR-106 流式输出 | ✅ 高 | 低 | LLMClient 已有 stream 支持 |
| FR-107 会话上下文持续 | ✅ 高 | 中 | 需实现 token 计数估算 |

### 需求覆盖度

- 用户核心诉求"交互和cc类似" → FR-101 + FR-106 + FR-107 覆盖 ✅
- 用户核心诉求"启动后支持配置更换模型" → FR-103 + FR-104 覆盖 ✅

## 2. 设计维度评审

### 架构兼容性：✅ 良好

新增 REPL 层是**增量式改造**，不破坏现有架构：

```
当前: lea run "desc" → CLI(commander) → AutonomousLoop → 各引擎
目标: lea → REPL → 斜杠命令/自然语言 → AutonomousLoop → 各引擎
         ↑                                    ↓
         └── 状态栏/权限确认/检查点交互 ←──────┘
```

- **REPL 是新的交互前端**，AutonomousLoop 是后端执行引擎
- REPL 和 commander 命令共存：`lea run` 仍可一键执行，`lea` 进入交互模式
- 无需重写任何现有模块

### 关键设计决策

| 决策 | 选项 | 推荐 | 理由 |
|------|------|------|------|
| REPL 实现 | readline vs inquirer vs 自研 | **readline + 自研** | inquirer 适合一次性问答，不适合持续 REPL 循环；readline 轻量，对流式输出控制力强 |
| 状态栏 | 全屏 TUI vs 顶行状态栏 | **顶行状态栏** | 全屏 TUI（blessed/ink）复杂度高且与流式输出冲突；顶行状态栏够用且侵入小 |
| 工作流可中断 | AbortController vs 标志位 | **AbortController** | Node.js 原生支持，可级联取消异步操作 |
| 模型热切换 | 重建 client vs 修改 config | **修改 config** | LLMClient 的 selectModel() 每次调用都读 config，只需改 config.models.default |
| 子代理模型同步 | env var 传递 vs workerData | **workerData** | Worker Threads 初始化时传入模型配置，避免 env var 污染 |

### 设计风险

1. **流式输出 + 交互提示冲突** — 流式输出进行中弹出权限确认会扰乱终端
   - 缓解：权限确认暂停流式输出，确认后继续
2. **长时间工作流阻塞 REPL** — 工作流是同步 while 循环
   - 缓解：AutonomousLoop.run() 改为异步可暂停，通过事件通知 REPL
3. **Ctrl+C 语义冲突** — 既要中断操作又要退出
   - 缓解：首次 Ctrl+C 中断操作，连续两次退出

## 3. 技术维度评审

### 改动量估算

| 模块 | 改动类型 | 估计行数 | 难度 |
|------|----------|----------|------|
| `src/cli/repl.ts` | **新增** | ~350 | 中 |
| `src/cli/commands.ts` | **新增** | ~200 | 低 |
| `src/cli/index.ts` | 修改 | ~30 | 低 |
| `src/model/llm-client.ts` | 修改 | ~40 | 低 |
| `src/engine/autonomous-loop.ts` | 修改 | ~80 | 中 |
| `src/security/permissions.ts` | 修改 | ~40 | 低 |
| `src/context/sub-agent-manager.ts` | 修改 | ~20 | 低 |
| `src/context/sub-agent-worker.ts` | 修改 | ~15 | 低 |
| `src/model/types.ts` | 修改 | ~10 | 低 |
| **合计** | | **~785** | |

### 依赖检查

| 依赖 | 当前状态 | 需要 |
|------|----------|------|
| inquirer | 已在 package.json | ✅ 用于权限确认等一次性交互 |
| readline | Node.js 内置 | ✅ 无需安装 |
| chalk | 已在 package.json | ✅ |
| ora | 已在 package.json | ✅ |
| ansi-escapes | **未安装** | 需新增 — 用于状态栏光标控制 |
| AbortController | Node.js 18+ 内置 | ✅ |

### 性能影响

- REPL 主循环：事件驱动，空载 CPU ~0%
- 状态栏刷新：仅在状态变化时更新，无持续开销
- 流式输出：与现有 LLMClient.stream 行为一致

### 兼容性

- Windows 终端兼容：需验证 ANSI escape codes 在 Windows Terminal / PowerShell 中的表现
- `readline` 在 Windows 上无已知问题
- Worker Threads 在 Windows 上正常工作

## 4. 评审结论

### 通过 ✅

需求明确、设计增量式、技术可行、改动量可控。

### 前置条件

1. 安装 `ansi-escapes` 依赖
2. Node.js 18+ 环境（AbortController 支持）

### 关键风险与缓解

| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| AutonomousLoop 同步阻塞 REPL | 中 | 改为事件驱动 + AbortController |
| 流式输出与交互提示冲突 | 中 | 交互提示时暂停流式输出 |
| Windows ANSI 兼容性 | 低 | 添加 Windows 兼容检测，fallback 到简单输出 |
