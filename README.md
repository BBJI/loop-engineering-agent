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

### 安装

```bash
git clone https://github.com/BBJI/loop-engineering-agent.git
cd loop-engineering-agent
npm install
npm run build
```

### 配置

```bash
# 生成默认配置文件
node dist/cli/index.js config init

# 查看模型配置
node dist/cli/index.js config model
```

编辑 `.lea/config.yaml`，配置 LiteLLM Proxy 地址和模型：

```yaml
litellm:
  proxy_url: http://localhost:4000

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

### 运行

```bash
# 启动工作流（半自主模式，每阶段暂停审批）
node dist/cli/index.js run "开发一个用户认证系统"

# 完全自主模式（无暂停）
node dist/cli/index.js run "开发一个REST API" --auto

# 预演模式（不执行实际操作）
node dist/cli/index.js run "开发功能" --dry-run
```

## 命令参考

```
lea run [描述]           启动工作流
  --model <name>         指定模型
  --auto                 完全自主模式
  --checkpoint <list>    指定检查点（逗号分隔）
  --dry-run              预演模式
  --verbose              详细输出
  --project <path>       项目目录

lea resume [id]          恢复中断的工作流
lea status               查看工作流状态
lea list                 列出所有工作流
lea skills               列出可用技能
lea compact              手动触发上下文压缩

lea config init          初始化配置文件
lea config model         查看模型配置
```

## 架构

```
src/
├── cli/                     CLI 入口和命令定义
│   └── index.ts             commander 命令注册
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

选择"始终允许"后，同类操作自动通过。所有敏感操作记录到审计日志。

## 开发

```bash
npm install          # 安装依赖
npm run build        # 编译
npm test             # 运行测试（37 测试用例）
npm run typecheck    # 类型检查
npm run dev          # 开发模式运行
```

## License

MIT
