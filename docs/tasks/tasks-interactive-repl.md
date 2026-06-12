# LEA 交互式 REPL — 任务拆分

## 任务依赖图

```
T-01 安装依赖
  ↓
T-02 LLMClient 模型热切换 ←── T-03 子代理模型配置同步
  ↓                                    ↓
T-04 REPL 核心 ────────────────→ T-05 斜杠命令
  ↓                                    ↓
T-06 状态栏 ←─────────────────── T-07 交互式权限确认
  ↓                                    ↓
T-08 AutonomousLoop 事件化 ─────→ T-09 集成测试
```

## T-01：安装依赖
- **内容**：安装 `ansi-escapes` npm 包
- **文件**：`package.json`
- **验收**：`npm install` 成功，无类型错误
- **预估**：5 min

## T-02：LLMClient 模型热切换
- **内容**：
  1. 新增 `switchModel(newModel: string)` 方法，修改 `config.models.default`
  2. 新增 `switchFallback(newFallback: string)` 方法
  3. 新增 `updateRouting(taskType, model)` 方法
  4. 新增 `listAvailableModels()` 方法（调用 LiteLLM Proxy `/v1/models` 接口）
  5. 新增 `getModelState()` 方法，返回当前默认/回退/路由/预算状态
- **文件**：`src/model/llm-client.ts`, `src/model/types.ts`
- **验收**：调用 `switchModel('deepseek-v3')` 后，后续 `chat()` 调用使用新模型
- **预估**：30 min

## T-03：子代理模型配置同步
- **内容**：
  1. `SubAgentRequest` 新增 `model` 字段
  2. `SubAgentManager.executeTask()` 传入当前 LLMClient 的模型配置
  3. `sub-agent-worker.ts` 使用 `workerData.model` 替代 `process.env.DEFAULT_MODEL`
  4. 新增 `proxyUrl` 字段，替代 `process.env.LITELLM_PROXY_URL`
- **文件**：`src/context/sub-agent-manager.ts`, `src/context/sub-agent-worker.ts`
- **验收**：切换主模型后，新创建的子代理 Worker 使用新模型
- **预估**：20 min

## T-04：REPL 核心循环
- **内容**：
  1. 创建 `src/cli/repl.ts`，实现 `REPL` 类
  2. `start()` 方法：初始化 readline，显示欢迎信息，进入主循环
  3. 输入分类：斜杠命令 → 命令处理器，自然语言 → LLM 调用
  4. 流式输出集成：调用 `LLMClient.chat()` with `stream: true`，逐 token 输出
  5. Ctrl+C 处理：首次中断当前操作，连续两次退出
  6. 会话历史管理：维护 `messages` 数组，支持上下文持续
  7. `compact` / `clear` 支持：压缩或清除对话历史
  8. 修改 `src/cli/index.ts`：`lea` 无子命令时启动 REPL
- **文件**：`src/cli/repl.ts`, `src/cli/index.ts`
- **验收**：`lea` 启动后进入交互式界面，可输入自然语言并获得流式响应
- **预估**：90 min

## T-05：斜杠命令
- **内容**：
  1. 创建 `src/cli/commands.ts`，定义所有斜杠命令处理函数
  2. 实现 `/model`, `/model <name>`, `/model list`, `/model routing`
  3. 实现 `/run <desc>`, `/resume [id]`, `/status`
  4. 实现 `/config <key> <value>`
  5. 实现 `/compact`, `/clear`, `/help`, `/exit`, `/budget`, `/permissions`
  6. 命令注册与路由：命令名 → 处理函数映射
- **文件**：`src/cli/commands.ts`
- **验收**：所有斜杠命令正常工作，输出格式符合设计规范
- **预估**：60 min

## T-06：状态栏
- **内容**：
  1. 创建 `src/cli/status-bar.ts`
  2. 使用 ANSI escape codes 在终端顶行渲染状态栏
  3. 字段：版本、模型、阶段、成本
  4. `update(field, value)` 方法更新特定字段
  5. `render()` 方法刷新顶行
  6. Windows 兼容：检测 `$env:WT_SESSION` 或 `TERM_PROGRAM`，不兼容时 fallback 到不渲染
  7. REPL 启动时初始化状态栏，退出时清理
- **文件**：`src/cli/status-bar.ts`
- **验收**：终端顶行实时显示 LEA 状态信息，模型切换/阶段流转时自动更新
- **预估**：45 min

## T-07：交互式权限确认
- **内容**：
  1. 修改 `PermissionManager.check()` 为异步方法 `async checkAsync()`
  2. `ask` 模式下调用 `inquirer.prompt()` 弹出交互式确认
  3. 支持三个选项：允许(y)、始终允许(s)、拒绝(n)
  4. "始终允许"调用 `grantAlways()` 加入白名单
  5. 保留同步 `check()` 方法用于非交互场景（子代理）
- **文件**：`src/security/permissions.ts`
- **验收**：ask 模式下 REPL 内弹出确认提示，用户选择后操作继续或阻止
- **预估**：30 min

## T-08：AutonomousLoop 事件化
- **内容**：
  1. `AutonomousLoop` 继承 `EventEmitter`
  2. 发射事件：`phase:start`, `phase:complete`, `checkpoint`, `bug:found`, `bug:fixed`, `escalate`, `done`
  3. `checkpoint` 事件携带阶段信息和制品，REPL 监听后弹出交互提示
  4. `run()` 改为可暂停：接受 `AbortSignal`，每次循环检查 `signal.aborted`
  5. 暂停时保存检查点，REPL 可后续调用 `resume()` 继续
  6. `PermissionManager.checkAsync()` 集成：子代理权限请求通过事件冒泡到 REPL
- **文件**：`src/engine/autonomous-loop.ts`
- **验收**：工作流执行中 REPL 可接收阶段进度事件，Ctrl+C 可暂停工作流
- **预估**：60 min

## T-09：集成测试
- **内容**：
  1. REPL 启动与退出测试
  2. 斜杠命令功能测试
  3. 模型热切换测试
  4. 工作流启动 + 检查点交互测试
  5. 权限确认流程测试
  6. 流式输出中断测试
- **文件**：`src/cli/repl.test.ts`, `src/cli/commands.test.ts`
- **验收**：所有测试通过
- **预估**：45 min

## 执行顺序

```
第一轮：T-01 → T-02 + T-03（并行）
第二轮：T-04 + T-06（并行）
第三轮：T-05 + T-07（并行）
第四轮：T-08
第五轮：T-09
```

总预估：~5.5h
