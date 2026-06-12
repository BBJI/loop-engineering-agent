# Loop Engineering Agent (LEA)

自主编程智能体 CLI 工具，基于 Loop Engineering 原则驱动软件从需求到交付的完整闭环。

## 技术栈

- TypeScript / Node.js (ESM)
- 依赖：commander, openai, zod, chalk, ora, js-yaml, inquirer
- 测试：Jest + ts-jest
- 模型接入：LiteLLM Proxy（OpenAI 兼容 API）

## 项目结构

```
src/
├── cli/           CLI 入口和命令定义
├── engine/        工作流引擎（状态机、持久化、自主循环、稳定性、制品管理）
├── model/         模型层（LLM 客户端、类型定义）
├── context/       上下文管理（压缩器、子代理管理器/worker）
├── skill/         技能引擎（SKILL.md 解释执行）
├── security/      安全（分级权限控制）
└── utils/         工具（常量、终端 UI）
```

## 开发命令

```bash
npm run build       # 编译 TypeScript
npm run dev         # 用 tsx 开发模式运行
npm test            # 运行测试（需要 ESM 支持）
npm run typecheck   # 类型检查
```

## 关键架构决策

- **状态机驱动**：WorkflowEngine 管理 6 阶段（req→design→review→task→dev→test）流转
- **混合上下文策略**：阶段边界自动压缩 + 子代理 Worker Threads 隔离
- **LiteLLM Proxy**：统一多模型接入，支持路由/回退/成本控制
- **JSON 文件持久化**：检查点保存/恢复，断点续跑
- **收敛闭环**：开发-测试反馈循环，Bug 数量递减检测

## 运行要求

- Node.js 18+
- LiteLLM Proxy（本地或远程）运行中
- 配置文件：`.lea/config.yaml`（通过 `lea config init` 生成）

## 约定

- 所有本地 import 使用 `.js` 扩展名（Node16 模块解析）
- 测试文件与源文件同目录，使用 `.test.ts` 后缀
- 持久化文件存储在项目目录下 `.lea/state/`
