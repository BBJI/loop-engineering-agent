# LEA 交互式 REPL + 动态模型配置 — 需求分析

## 1. 需求来源

用户原话："交互应该和cc类似，现在是直接就光输命令了，而且启动后需要支持配置更换模型"

**CC (Claude Code)** 的交互模式特点：
- 启动后进入交互式对话界面，持续等待用户输入
- 用户可随时发指令，智能体实时响应
- 支持斜杠命令（/help, /model 等）进行运行时配置
- 流式输出，用户能实时看到模型回复
- 权限确认内嵌在对话流中（而非外部命令）
- 上下文在会话内持续积累

## 2. 现状问题分析

### 问题 P-001：交互模式单一
- **现状**：`lea run "desc"` → 一次性执行 → 输出结果 → 退出
- **差距**：无持续交互能力，用户无法在运行时干预、调整或追加指令
- **影响**：用户体验差，无法实现"人机协作"

### 问题 P-002：检查点暂停无实际交互
- **现状**：`semi` 模式下检查点只打印 "workflow paused" 然后退出，需用 `lea resume` 恢复
- **差距**：设计文档中描述了"用户批准/拒绝/暂停"三选一，但代码中未实现
- **影响**：半自主模式名不副实

### 问题 P-003：权限 "ask" 模式等效于拒绝
- **现状**：`PermissionManager.evaluateAction('ask')` 直接返回 `{ allowed: false, reason: '需要用户确认' }`
- **差距**：没有实际的 inquirer 交互提示
- **影响**：用户无法在运行时批准敏感操作

### 问题 P-004：模型配置启动后不可变
- **现状**：模型在启动时通过 `--model` 参数或 config.yaml 确定，运行时无法切换
- **差距**：无法根据任务实际情况动态调整模型选择
- **影响**：无法灵活应对不同阶段的模型需求变化

### 问题 P-005：子代理绕过 LLMClient
- **现状**：Worker Threads 直接用 env var 创建 OpenAI client，绕过路由/预算/回退
- **差距**：子代理的模型配置与主流程脱节
- **影响**：模型切换无法影响子代理；预算追踪不完整

## 3. 功能需求

### FR-101：交互式 REPL 主循环
- **描述**：LEA 启动后进入交互式对话界面，持续接受用户输入，实时响应
- **优先级**：Must
- **验收标准**：
  - Given 执行 `lea`（无子命令），When 进入 REPL，Then 显示欢迎信息和提示符
  - Given 在 REPL 中输入自然语言，When 发送，Then LLM 实时流式响应
  - Given 在 REPL 中输入斜杠命令（如 /help），When 发送，Then 立即执行命令并显示结果
  - Given 在 REPL 中按 Ctrl+C，When 无正在执行的操作，Then 退出
  - Given 在 REPL 中按 Ctrl+C，When 有正在执行的操作，Then 中断当前操作但不退出
- **依赖**：无

### FR-102：工作流启动与监控
- **描述**：在 REPL 内启动工作流，实时查看进度，可在任意检查点干预
- **优先级**：Must
- **验收标准**：
  - Given 在 REPL 中输入 `/run <description>`，When 发送，Then 启动工作流并实时显示进度
  - Given 工作流到达检查点，When 暂停，Then REPL 提示用户批准/修改/暂停
  - Given 用户批准检查点，When 继续，Then 工作流推进到下一阶段
  - Given 用户拒绝检查点并附修改意见，When 继续，Then 当前阶段重做
  - Given 工作流正在执行，When 用户输入其他指令，Then 排队处理或并行响应
- **依赖**：FR-101

### FR-103：运行时模型切换
- **描述**：在 REPL 运行期间动态切换当前使用的模型
- **优先级**：Must
- **验收标准**：
  - Given 在 REPL 中输入 `/model <name>`，When 发送，Then 当前会话的模型立即切换
  - Given 切换模型后，When 下一次 LLM 调用，Then 使用新模型
  - Given 在 REPL 中输入 `/model`（无参数），When 发送，Then 显示当前模型配置（默认、回退、路由）
  - Given 工作流正在执行，When 切换模型，Then 不影响已提交的请求，影响后续请求
  - Given LiteLLM Proxy 可用模型列表，When 输入 `/model list`，Then 显示可用模型
- **依赖**：FR-101

### FR-104：运行时配置调整
- **描述**：在 REPL 中调整权限、自主级别等运行时配置
- **优先级**：Should
- **验收标准**：
  - Given 在 REPL 中输入 `/config autonomy <level>`，When 发送，Then 切换自主级别
  - Given 在 REPL 中输入 `/config budget <amount>`，When 发送，Then 更新每日预算上限
  - Given 在 REPL 中输入 `/config routing <taskType> <model>`，When 发送，Then 更新路由规则
- **依赖**：FR-101, FR-103

### FR-105：交互式权限确认
- **描述**：当智能体请求敏感操作时，在 REPL 内联提示用户确认
- **优先级**：Must
- **验收标准**：
  - Given 权限模式为 ask，When 智能体请求文件写入，Then REPL 内联显示确认提示
  - Given 确认提示，When 用户选择"允许"，Then 操作执行
  - Given 确认提示，When 用户选择"始终允许"，Then 后续同类操作自动通过
  - Given 确认提示，When 用户选择"拒绝"，Then 操作被阻止
- **依赖**：FR-101

### FR-106：流式输出
- **描述**：LLM 响应实时流式输出到终端，而非等待完整响应后一次性显示
- **优先级**：Must
- **验收标准**：
  - Given LLM 开始生成，When 收到 token，Then 实时追加到终端输出
  - Given 流式输出中，When 用户按 Ctrl+C，Then 中断生成
  - Given 流式输出完成，When 显示完毕，Then 显示 token 用量和耗时统计
- **依赖**：FR-101

### FR-107：会话内上下文持续
- **描述**：REPL 会话内的对话历史持续积累，直到用户主动清除或会话结束
- **优先级**：Must
- **验收标准**：
  - Given 多轮对话，When 发送新消息，Then 包含之前对话历史作为上下文
  - Given 在 REPL 中输入 `/compact`，When 发送，Then 压缩当前对话历史
  - Given 在 REPL 中输入 `/clear`，When 发送，Then 清除对话历史重新开始
  - Given 对话历史接近上下文限制，When 自动触发，Then 提示用户或自动压缩
- **依赖**：FR-101, FR-106

## 4. 斜杠命令设计

| 命令 | 描述 | 示例 |
|------|------|------|
| `/run <desc>` | 启动工作流 | `/run 实现用户认证` |
| `/resume [id]` | 恢复工作流 | `/resume wf-001` |
| `/status` | 查看当前工作流状态 | `/status` |
| `/model [name]` | 查看/切换模型 | `/model deepseek-v3` |
| `/model list` | 列出可用模型 | `/model list` |
| `/model routing` | 查看路由配置 | `/model routing` |
| `/config <key> <value>` | 调整配置 | `/config autonomy full` |
| `/compact` | 压缩对话历史 | `/compact` |
| `/clear` | 清除对话历史 | `/clear` |
| `/help` | 显示帮助 | `/help` |
| `/exit` | 退出 REPL | `/exit` |
| `/permissions` | 查看权限状态 | `/permissions` |
| `/budget` | 查看预算消耗 | `/budget` |

## 5. 非功能需求

### NFR-101：REPL 响应延迟
- 首个 token 输出延迟 < 1s（不含模型推理时间）
- 斜杠命令响应 < 200ms

### NFR-102：REPL 稳定性
- 流式输出中断不导致 REPL 崩溃
- 工作流执行错误不导致 REPL 退出

### NFR-103：模型热切换无感
- 切换模型后第一次调用可能有额外延迟（新连接建立），但不应超过 2s
- 切换过程中正在进行的请求不受影响

### NFR-104：上下文持续可靠性
- 对话历史不会意外丢失
- 自动压缩不会导致关键信息丢失

## 6. 影响分析

### 新增模块
- `src/cli/repl.ts` — REPL 主循环（read-eval-print）
- `src/cli/commands.ts` — 斜杠命令处理

### 需修改模块
- `src/cli/index.ts` — 新增 `lea` 无参数时启动 REPL
- `src/model/llm-client.ts` — 支持运行时模型切换，暴露 `switchModel()` 方法
- `src/engine/autonomous-loop.ts` — 集成交互式检查点确认
- `src/security/permissions.ts` — 集成 inquirer 交互式权限确认
- `src/context/sub-agent-manager.ts` — 通过主 LLMClient 配置子代理模型
- `src/model/types.ts` — Config 类型可能需要调整

### 不受影响模块
- `src/engine/workflow.ts` — 状态机逻辑不变
- `src/engine/persistence.ts` — 持久化逻辑不变
- `src/engine/stability.ts` — 稳定性逻辑不变
- `src/engine/artifacts.ts` — 制品管理不变
- `src/skill/skill-engine.ts` — 技能引擎不变
