import type { LLMClient } from '../model/llm-client.js';
import type { Config } from '../model/types.js';
import type { PersistenceManager } from '../engine/persistence.js';
import type { WorkflowEngine } from '../engine/workflow.js';
import { saveConfig } from '../config.js';
import { ui } from '../utils/ui.js';
import { VERSION } from '../utils/constants.js';

export interface CommandContext {
  llmClient: LLMClient;
  config: Config;
  persistence: PersistenceManager;
  projectDir: string;
  engine?: WorkflowEngine;
  onModelSwitch?: (oldModel: string, newModel: string) => void;
}

type CommandHandler = (args: string[], ctx: CommandContext) => Promise<string | void>;

const COMMANDS: Record<string, {
  handler: CommandHandler;
  help: string;
  usage: string;
}> = {};

export function getCommand(name: string) {
  return COMMANDS[name];
}

export function getAllCommands() {
  return Object.entries(COMMANDS).map(([name, def]) => ({
    name,
    help: def.help,
    usage: def.usage,
  }));
}

// --- Command implementations ---

COMMANDS['help'] = {
  help: '显示帮助信息',
  usage: '/help',
  handler: async () => {
    const lines = ['可用命令:', ''];
    for (const [name, def] of Object.entries(COMMANDS)) {
      lines.push(`  ${ui.bold(name.padEnd(20))} ${def.help}`);
    }
    lines.push('', '自然语言输入将发送给 LLM 处理');
    return lines.join('\n');
  },
};

COMMANDS['model'] = {
  help: '查看或切换模型',
  usage: '/model [name] | /model list | /model routing',
  handler: async (args, ctx) => {
    if (args.length === 0) {
      const state = ctx.llmClient.getModelState();
      return [
        ui.model('当前模型配置:'),
        `  默认: ${state.default}`,
        `  回退: ${state.fallback}`,
        `  路由: ${JSON.stringify(state.routing)}`,
        `  预算: $${state.budget.dailySpend.toFixed(2)} / $${state.budget.dailyLimit.toFixed(2)}`,
        `  调用次数: ${state.callCount}`,
      ].join('\n');
    }

    if (args[0] === 'list') {
      const models = await ctx.llmClient.listAvailableModels();
      return [
        ui.model('可用模型:'),
        ...models.map((m) => `  ${m}`),
      ].join('\n');
    }

    if (args[0] === 'routing') {
      const state = ctx.llmClient.getModelState();
      return [
        ui.model('路由配置:'),
        ...Object.entries(state.routing).map(([k, v]) => `  ${k} → ${v}`),
      ].join('\n');
    }

    const newModel = args[0];
    const oldModel = ctx.llmClient.switchModel(newModel);
    ctx.onModelSwitch?.(oldModel, newModel);
    return ui.model(`模型已切换: ${oldModel} → ${newModel}`);
  },
};

COMMANDS['config'] = {
  help: '调整运行时配置',
  usage: '/config <key> <value>',
  handler: async (args, ctx) => {
    if (args.length < 2) {
      return '用法: /config <key> <value>\n可用: autonomy, budget, routing';
    }

    const [key, ...valueParts] = args;
    const value = valueParts.join(' ');

    switch (key) {
      case 'autonomy': {
        if (!['full', 'semi', 'manual'].includes(value)) {
          return ui.fail('autonomy 可选值: full, semi, manual');
        }
        ctx.config.workflow.autonomy = value as 'full' | 'semi' | 'manual';
        saveConfig(ctx.projectDir, ctx.config);
        return ui.success(`配置已更新: autonomy = ${value}`);
      }
      case 'budget': {
        const amount = parseFloat(value);
        if (isNaN(amount) || amount <= 0) {
          return ui.fail('budget 需为正数');
        }
        ctx.config.models.cost_budget.daily_limit = amount;
        saveConfig(ctx.projectDir, ctx.config);
        return ui.success(`配置已更新: budget = $${amount}`);
      }
      case 'proxy_url': {
        ctx.config.litellm.proxy_url = value;
        saveConfig(ctx.projectDir, ctx.config);
        return ui.success(`配置已更新: proxy_url = ${value}\n提示: 需重启 REPL 使新 Proxy 地址生效`);
      }
      case 'api_key': {
        ctx.config.litellm.api_key = value;
        saveConfig(ctx.projectDir, ctx.config);
        return ui.success(`配置已更新: api_key = ${value.substring(0, 4)}${'*'.repeat(Math.max(0, value.length - 4))}\n提示: 需重启 REPL 使新 API Key 生效`);
      }
      case 'routing': {
        const routingMatch = value.match(/^(\w+)\s+(.+)$/);
        if (!routingMatch) {
          return ui.fail('用法: /config routing <taskType> <model>\n可用: simple_tasks, complex_tasks, code_generation, code_review');
        }
        const [, taskType, model] = routingMatch;
        if (!(taskType in ctx.config.models.routing)) {
          return ui.fail(`未知任务类型: ${taskType}\n可用: ${Object.keys(ctx.config.models.routing).join(', ')}`);
        }
        ctx.config.models.routing[taskType as keyof Config['models']['routing']] = model;
        saveConfig(ctx.projectDir, ctx.config);
        return ui.success(`配置已更新: routing.${taskType} = ${model}`);
      }
      default:
        return ui.fail(`未知配置项: ${key}\n可用: autonomy, budget, proxy_url, api_key, routing`);
    }
  },
};

COMMANDS['budget'] = {
  help: '查看预算消耗',
  usage: '/budget',
  handler: async (_args, ctx) => {
    const state = ctx.llmClient.getModelState();
    return [
      ui.model('预算消耗:'),
      `  今日花费: $${state.budget.dailySpend.toFixed(4)} / $${state.budget.dailyLimit.toFixed(2)}`,
      `  单任务上限: $${state.budget.perTaskLimit.toFixed(2)}`,
      `  调用次数: ${state.callCount}`,
    ].join('\n');
  },
};

COMMANDS['compact'] = {
  help: '压缩对话历史',
  usage: '/compact',
  handler: async () => {
    return ui.warn('上下文压缩将在对话历史过长时自动触发');
  },
};

COMMANDS['clear'] = {
  help: '清除对话历史',
  usage: '/clear',
  handler: async () => {
    return '__CLEAR__';
  },
};

COMMANDS['status'] = {
  help: '查看工作流状态',
  usage: '/status',
  handler: async (_args, ctx) => {
    if (!ctx.engine) {
      const workflows = ctx.persistence.listWorkflows();
      if (workflows.length === 0) {
        return ui.dim('暂无工作流');
      }
      return workflows.map((w) => `  ${w.id}  ${w.status}  ${w.updatedAt}`).join('\n');
    }

    const state = ctx.engine.getState();
    const lines = [
      `  项目: ${state.description.substring(0, 50)}`,
      `  状态: ${state.status}`,
      `  当前阶段: ${state.phases[state.currentPhaseIndex]?.name || '—'}`,
      '',
    ];

    for (const p of state.phases) {
      const icon = p.status === 'completed' ? '✓' : p.status === 'running' ? '●' : '○';
      const label = p.status === 'completed' ? '已完成' : p.status === 'running' ? '进行中' : '待开始';
      lines.push(`  ${icon} ${p.name}  ${label}`);
    }

    return lines.join('\n');
  },
};

COMMANDS['resume'] = {
  help: '恢复中断的工作流',
  usage: '/resume [id]',
  handler: async (args, ctx) => {
    if (args.length === 0) {
      const workflows = ctx.persistence.listWorkflows();
      if (workflows.length === 0) {
        return ui.warn('无可恢复的工作流');
      }
      return [
        ui.phase('未完成的工作流:'),
        ...workflows.map((w, i) => `  #${i + 1}  ${w.id}  ${w.status}  ${w.updatedAt}`),
      ].join('\n');
    }
    return ui.success(`恢复工作流: ${args[0]}`);
  },
};

COMMANDS['permissions'] = {
  help: '查看权限状态',
  usage: '/permissions',
  handler: async (_args, ctx) => {
    return [
      '权限配置:',
      `  文件读取: 自动允许`,
      `  文件写入: ${ctx.config.permissions.allow_write}`,
      `  命令执行: ${ctx.config.permissions.allow_command}`,
      `  黑名单: ${ctx.config.permissions.deny_commands.join(', ')}`,
    ].join('\n');
  },
};

COMMANDS['exit'] = {
  help: '退出 REPL',
  usage: '/exit',
  handler: async () => {
    return '__EXIT__';
  },
};

COMMANDS['version'] = {
  help: '显示版本',
  usage: '/version',
  handler: async () => {
    return `LEA v${VERSION}`;
  },
};
