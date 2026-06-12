# Loop Engineering Agent (LEA)

基于 [Loop Engineering](#什么是-loop-engineering) 原则的自主编程智能体。通过收敛反馈闭环驱动软件从需求到交付的完整流程，解决 AI 编程中的三个核心工程挑战：

- **上下文溢出** — 长时间执行超出窗口限制导致中断
- **进度丢失** — 清除上下文后无法恢复任务进度
- **无法自主** — 任务未完成时需要人工介入

## 解决方案

| 问题 | 方案 | 实现 |
|------|------|------|
| 上下文溢出 | 阶段边界自动压缩 + 子代理 Worker Threads 隔离 | `ContextManager` + `SubAgentManager` |
| 进度丢失 | JSON 检查点持久化 + 断点恢复 | `PersistenceManager` + `lea resume` |
| 无法自主 | 自主执行闭环 + 收敛检测 + 错误升级 | `AutonomousLoop` + `WorkflowEngine` |

## 什么是 Loop Engineering

传统软件交付是线性的：需求 → 设计 → 开发 → 测试 → 发布。问题在于晚期发现的缺陷修复成本很高，且反馈不会回流。

Loop Engineering 用**收敛反馈闭环**替代线性流程：

```
  需求分析 ──► UI/UX设计 ──► 实现评估 ──► 任务拆分
      │                                │
      │        ┌─── 开发实现 ◄─────────┘
      │        │
      │        ▼
      │     测试验证 ──────────────────┐
      │        │                      │
      │   (Bug → 开发修复)            │
      │        │                      │
      ▼        ▼                      │
    项目规范 ◄────────────────────────┘
```

测试发现 Bug 时自动反馈给开发修复，Bug 数量每轮递减直至收敛为零。闭环在每次迭代中收窄，直到所有验收标准通过。

## 快速开始

### 前置条件

- Node.js 18+
- [LiteLLM Proxy](https://github.com/BerriAI/litellm) 运行中（用于统一接入各模型厂商）

### 一键安装

```bash
npm install -g @niuzhiwen/loop-engineering-agent
```

安装后即可直接使用 `lea` 命令：

```bash
lea --help
```

也可以免安装直接运行：

```bash
npx @niuzhiwen/loop-engineering-agent run "开发一个用户认证系统"
```

### 从源码安装

```bash
git clone https://github.com/BBJI/loop-engineering-agent.git
cd loop-engineering-agent
npm install
npm run build
```

### 配置

**首次使用会自动引导配置** — 启动 `lea` 后，如果未检测到配置文件，会进入交互式引导向导：

```
  LEA v0.1.0 — Loop Engineering Agent
  ════════════════════════════════════
  ◆ 首次使用引导 — 配置模型和 API

? 选择模型接入方式: LiteLLM Proxy（统一代理，推荐）
? LiteLLM Proxy 地址: http://localhost:4000
? LiteLLM Proxy API Key（留空跳过）: sk-xxxx
? 选择默认模型: glm-4
? 选择回退模型: deepseek-v3
? 选择自主级别: 半自主 — 阶段检查点暂停审批

  ✓ 配置完成！已保存到 .lea/config.yaml
```

也支持两种接入方式：

1. **LiteLLM Proxy（推荐）** — 各厂商 Key 配在 Proxy 侧，LEA 统一调用
2. **直连模型厂商** — 填入厂商 API Key 和 Base URL，LEA 直接对接

手动初始化配置文件：

```bash
lea config init    # 启动交互式配置向导
```

编辑 `.lea/config.yaml`，配置 LiteLLM Proxy 地址和模型：

```yaml
litellm:
  proxy_url: http://localhost:4000
  api_key: your-litellm-key        # 可选，LiteLLM Proxy 的访问密钥

models:
  default: glm-4
  fallback: deepseek-v3
  routing:
    simple_tasks: deepseek-v3
    complex_tasks: glm-4
    code_generation: deepseek-v3
    code_review: claude-4
  cost_budget:
    daily_limit: 10.0
    per_task_limit: 2.0
```

> **各模型厂商的 API Key** 配置在 LiteLLM Proxy 的 `litellm_config.yaml` 中，LEA 通过 Proxy 统一调用。如果你直接使用 LEA 连接模型服务（不经过 Proxy），可在 REPL 中用 `/config api_key <key>` 设置。

> **在 REPL 中修改配置**：所有 `/config` 命令的变更会自动持久化到 `.lea/config.yaml`，重启后保留。

### 运行

#### 交互式 REPL（推荐）

```bash
# 启动交互式对话界面
lea

# 进入 REPL 后：
❯ 帮我分析这段代码的问题                # 自然语言对话（流式输出）
❯ /run 开发一个用户认证系统             # 启动工作流
❯ /model deepseek-v3                   # 运行时切换模型
❯ /model list                          # 查看可用模型
❯ /model routing                       # 查看路由配置
❯ /config autonomy full                # 切换自主级别
❯ /config budget 20                    # 调整每日预算
❯ /budget                              # 查看预算消耗
❯ /status                              # 查看工作流状态
❯ /resume wf-001                       # 恢复暂停的工作流
❯ /compact                             # 压缩对话历史
❯ /clear                               # 清除对话历史
❯ /permissions                         # 查看权限状态
❯ /help                                # 查看所有命令
❯ /exit                                # 退出 REPL
```

REPL 特性：
- **流式输出** — 模型回复实时逐 token 显示
- **运行时模型切换** — `/model <name>` 即时生效，同步到子代理
- **检查点交互** — 半自主模式下阶段完成后可批准/修改/暂停
- **权限确认** — 敏感操作内嵌提示，支持允许/始终允许/拒绝
- **Ctrl+C** — 首次中断当前操作，连续两次退出

#### 一键执行（向后兼容）

```bash
# 启动工作流（半自主模式，每阶段暂停审批）
lea run "开发一个用户认证系统"

# 完全自主模式（无暂停）
lea run "开发一个REST API" --auto

# 预演模式（不执行实际操作）
lea run "开发功能" --dry-run
```

## 命令参考

### CLI 命令

```
lea                        启动交互式 REPL（推荐）
lea run [描述]             启动工作流
  --model <name>           指定模型
  --auto                   完全自主模式
  --checkpoint <list>      指定检查点（逗号分隔）
  --dry-run                预演模式
  --verbose                详细输出
  --project <path>         项目目录

lea resume [id]            恢复中断的工作流
lea status                 查看工作流状态
lea list                   列出所有工作流
lea skills                 列出可用技能
lea compact                手动触发上下文压缩

lea config init            初始化配置文件
lea config model           查看模型配置
```

### REPL 内斜杠命令

```
/run <描述>                启动工作流
/resume [id]               恢复工作流
/status                    查看工作流状态
/model                     查看当前模型配置
/model <name>              切换模型（即时生效）
/model list                列出可用模型
/model routing             查看路由配置
/config <key> <value>      调整运行时配置（autonomy/budget/api_key/proxy_url/routing）
                           示例: /config api_key sk-xxxx
                                 /config proxy_url http://localhost:4000
                                 /config routing code_generation deepseek-v3
/budget                    查看预算消耗
/permissions               查看权限状态
/compact                   压缩对话历史
/clear                     清除对话历史
/help                      显示帮助
/exit                      退出 REPL
```

## 架构

```
src/
├── cli/                     CLI 入口和交互式 REPL
│   ├── index.ts             commander 命令注册 + REPL 启动
│   ├── repl.ts              交互式 REPL 主循环（流式输出、会话管理、Ctrl+C 处理）
│   ├── commands.ts          斜杠命令处理器（/model, /run, /config 等）
│   ├── setup-wizard.ts      首次使用引导向导（模型、API Key、自主级别）
│   └── status-bar.ts        终端顶部状态栏（版本/模型/阶段/成本）
├── engine/                  工作流引擎
│   ├── workflow.ts          状态机（6阶段流转、门控、回退、收敛检测）
│   ├── persistence.ts       持久化（检查点、审计日志、心跳）
│   ├── autonomous-loop.ts   自主执行闭环
│   ├── stability.ts         稳定性保障（内存监控、心跳、定时检查点）
│   └── artifacts.ts         制品版本管理
├── model/                   模型层
│   ├── types.ts             Zod schema + Config 类型
│   └── llm-client.ts        LiteLLM 客户端（路由、回退、流式、成本追踪）
├── context/                 上下文管理
│   ├── compression.ts       边界压缩器（PhaseSummary 生成）
│   ├── sub-agent-manager.ts 子代理调度器（Worker Threads）
│   └── sub-agent-worker.ts  子代理执行器（独立上下文）
├── skill/                   技能引擎
│   └── skill-engine.ts      SKILL.md 解释执行
├── security/                安全
│   └── permissions.ts       分级权限控制
└── utils/                   工具
    ├── constants.ts         常量定义
    └── ui.ts                终端 UI（Spinner、进度条、状态面板）
```

### 上下文管理策略

**混合策略** = 边界压缩 + 子代理隔离：

1. **边界压缩**：阶段完成时，将该阶段的详细交互压缩为结构化摘要（`PhaseSummary`），释放上下文窗口。压缩使用高能力模型确保摘要质量，原始数据持久化到磁盘供回溯。

2. **子代理隔离**：开发/测试阶段的每个任务在独立 Worker Thread 中执行，拥有独立上下文。子代理完成后仅返回结果摘要，不污染主控上下文。

### 收敛闭环

开发-测试形成收敛闭环：

```
测试发现Bug → Bug报告 → 开发修复 → 重测 → 循环
```

- 每迭代最多 3 个 Bug 修复周期
- Bug 数量应递减：[8] → [3] → [1] → [0]
- 连续 3 轮无新 Bug 声明稳定
- 不收敛（3轮不减反增）时自动升级给用户

### 多模型接入

通过 [LiteLLM Proxy](https://github.com/BerriAI/litellm) 统一接入 100+ 模型厂商：

| 厂商 | 模型 | API 兼容 |
|------|------|---------|
| 智谱 | GLM-4 | OpenAI 兼容 |
| DeepSeek | DeepSeek-V3 / R1 | OpenAI 兼容 |
| OpenAI | GPT-4o | 原生 |
| Anthropic | Claude 4 | 需 LiteLLM 转换 |

支持路由策略（按任务类型选择模型）、自动回退、成本预算控制。

## 技能体系

LEA 内置 [dev-workflow-skills](https://github.com/BBJI/dev-workflow-skills) 技能体系的解释执行引擎。将 SKILL.md 文件作为 prompt 模板注入到 LLM 调用中，实现声明式技能定义：

| 阶段 | 技能 | 说明 |
|------|------|------|
| 需求分析 | `req-analysis-skill` | 将模糊想法转化为结构化需求文档 |
| 设计 | `design-skill` | 将需求转化为设计规范 |
| 评估 | `review-skill` | 三维度实现评估（需求/设计/技术） |
| 任务拆分 | `task-allocation-skill` | 分解为可实施任务和迭代计划 |
| 开发 | `dev-skill` | 编码实现和 Bug 修复 |
| 测试 | `test-skill` | 验证交付物是否符合规格 |

技能文件放入 `~/.lea/skills/` 目录即可自动发现和加载。

## 安全模型

分级权限控制，类似 Claude Code 的权限模式：

| 操作类型 | 默认行为 |
|---------|---------|
| 文件读取 | 自动允许 |
| 文件写入 | 需确认（可配置为 auto/ask/deny） |
| 命令执行 | 需确认（可配置） |
| 黑名单命令 | 始终需确认（`rm -rf`, `git push --force` 等） |

REPL 中 `ask` 模式下弹出内嵌确认提示（`[A] 允许 [S] 始终允许 [D] 拒绝`），选择"始终允许"后同类操作自动通过。所有敏感操作记录到审计日志。

## 开发

```bash
npm install          # 安装依赖
npm run build        # 编译
npm test             # 运行测试（59 测试用例）
npm run typecheck    # 类型检查
npm run dev          # 开发模式运行
```

## License

MIT
