import * as readline from 'readline';
import type { LLMClient } from '../model/llm-client.js';
import type { Config } from '../model/types.js';
import type { PersistenceManager } from '../engine/persistence.js';
import type { WorkflowEngine } from '../engine/workflow.js';
import type { AutonomousLoop } from '../engine/autonomous-loop.js';
import { ContextManager } from '../context/compression.js';
import { SubAgentManager } from '../context/sub-agent-manager.js';
import { SkillEngine } from '../skill/skill-engine.js';
import { PermissionManager } from '../security/permissions.js';
import { WorkflowEngine as WE } from '../engine/workflow.js';
import { ui } from '../utils/ui.js';
import { VERSION } from '../utils/constants.js';
import { StatusBar } from './status-bar.js';
import { getCommand, getAllCommands, type CommandContext } from './commands.js';
import OpenAI from 'openai';

export interface REPLSession {
  llmClient: LLMClient;
  config: Config;
  persistence: PersistenceManager;
  projectDir: string;
}

const SYSTEM_PROMPT = `You are LEA (Loop Engineering Agent), an autonomous programming assistant.
You help developers with software engineering tasks using a structured workflow approach.
Respond concisely and helpfully. When asked to implement features, suggest using /run to start a workflow.`;

export class REPL {
  private rl: readline.Interface;
  private statusBar: StatusBar;
  private messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  private running = false;
  private abortController: AbortController | null = null;
  private engine?: WorkflowEngine;
  private loop?: AutonomousLoop;
  private contextManager?: ContextManager;
  private subAgentManager?: SubAgentManager;
  private skillEngine?: SkillEngine;
  private permissionManager?: PermissionManager;
  private consecutiveCtrlC = 0;
  private ctrlCTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private session: REPLSession) {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '',
      historySize: 100,
      removeHistoryDuplicates: true,
    });

    this.statusBar = new StatusBar({
      version: VERSION,
      model: session.config.models.default,
      phase: '—',
      cost: '$0.00',
    });

    this.messages.push({ role: 'system', content: SYSTEM_PROMPT });
  }

  async start(): Promise<void> {
    this.running = true;

    this.initComponents();

    console.log('');
    console.log(ui.bold(`  LEA v${VERSION} — Loop Engineering Agent`));
    console.log('  ────────────────────────────────────');
    console.log(`  模型: ${ui.model(this.session.config.models.default)} (via LiteLLM Proxy)`);
    console.log(`  项目: ${this.session.projectDir}`);

    const workflows = this.session.persistence.listWorkflows();
    if (workflows.length > 0) {
      const unfinished = workflows.filter((w: any) => w.status !== 'completed');
      if (unfinished.length > 0) {
        console.log(`  工作流: ${unfinished.length} 个未完成 (输入 /resume 恢复)`);
      }
    }

    console.log('');
    console.log('  输入需求描述或 /help 查看命令');
    console.log('');

    this.statusBar.enable();

    this.rl.on('line', async (line) => {
      const input = line.trim();
      if (!input) {
        this.showPrompt();
        return;
      }

      this.consecutiveCtrlC = 0;
      await this.handleInput(input);
    });

    this.rl.on('close', () => {
      this.cleanup();
    });

    process.on('SIGINT', () => {
      this.handleCtrlC();
    });

    this.showPrompt();
  }

  private initComponents(): void {
    this.contextManager = new ContextManager(this.session.llmClient, this.session.persistence);
    this.subAgentManager = new SubAgentManager();
    this.subAgentManager.configure(this.session.config.models.default, this.session.config.litellm.proxy_url);
    this.skillEngine = new SkillEngine(
      this.session.config.skills.directory.replace('~', process.env.HOME || '~'),
      this.session.llmClient
    );
    this.skillEngine.loadSkills();
    this.permissionManager = new PermissionManager(this.session.config, this.session.persistence);
  }

  private showPrompt(): void {
    this.rl.setPrompt(ui.bold('❯ '));
    this.rl.prompt();
  }

  private async handleInput(input: string): Promise<void> {
    if (input.startsWith('/')) {
      await this.handleCommand(input);
    } else {
      await this.handleChat(input);
    }
    this.showPrompt();
  }

  private async handleCommand(input: string): Promise<void> {
    const parts = input.slice(1).split(/\s+/);
    const cmdName = parts[0];
    const args = parts.slice(1);

    if (cmdName === 'run') {
      await this.handleRunCommand(args.join(' '));
      return;
    }

    const cmd = getCommand(cmdName);
    if (!cmd) {
      console.log(ui.fail(`未知命令: /${cmdName}，输入 /help 查看可用命令`));
      return;
    }

    const ctx = this.buildCommandContext();
    const result = await cmd.handler(args, ctx);

    if (result === '__EXIT__') {
      this.cleanup();
      process.exit(0);
      return;
    }

    if (result === '__CLEAR__') {
      this.messages = [{ role: 'system', content: SYSTEM_PROMPT }];
      console.log(ui.success('对话历史已清除'));
      return;
    }

    if (result) console.log(result);
  }

  private async handleRunCommand(description: string): Promise<void> {
    if (!description) {
      console.log(ui.fail('请提供需求描述: /run <description>'));
      return;
    }

    this.engine = new WE(this.session.projectDir, description, this.session.config);
    this.statusBar.update({ phase: 'req' });

    console.log(ui.phase(`工作流启动: ${description}`));
    console.log('─'.repeat(40));

    const { AutonomousLoop: AL } = await import('../engine/autonomous-loop.js');
    this.loop = new AL(
      this.engine,
      this.session.llmClient,
      this.session.persistence,
      this.contextManager!,
      this.subAgentManager!,
      this.skillEngine!,
      this.permissionManager!,
      this.session.config
    );

    try {
      this.abortController = new AbortController();
      const finalState = await this.loop.run();

      this.statusBar.update({
        phase: finalState.phases[finalState.currentPhaseIndex]?.name || '—',
        cost: `$${this.session.llmClient.getStats().dailySpend.toFixed(2)}`,
      });

      if (finalState.status === 'completed') {
        console.log(ui.success('工作流已完成'));
        this.engine = undefined;
        this.loop = undefined;
      } else if (finalState.status === 'paused') {
        console.log(ui.warn('工作流已暂停，输入 /resume 继续'));
      }
    } catch (err: any) {
      if (err.message?.includes('aborted')) {
        console.log(ui.warn('工作流已中断'));
      } else {
        console.log(ui.fail(`工作流错误: ${err.message}`));
      }
    } finally {
      this.abortController = null;
    }
  }

  private async handleChat(input: string): Promise<void> {
    this.messages.push({ role: 'user', content: input });

    this.abortController = new AbortController();

    try {
      console.log('');
      const result = await this.session.llmClient.chat(this.messages, { stream: true });
      this.messages.push({ role: 'assistant', content: result.content });

      const stats = this.session.llmClient.getStats();
      this.statusBar.update({ cost: `$${stats.dailySpend.toFixed(2)}` });
    } catch (err: any) {
      if (!err.message?.includes('aborted')) {
        console.log(ui.fail(`错误: ${err.message}`));
      }
    } finally {
      this.abortController = null;
    }

    console.log('');
  }

  private handleCtrlC(): void {
    this.consecutiveCtrlC++;

    if (this.ctrlCTimer) clearTimeout(this.ctrlCTimer);
    this.ctrlCTimer = setTimeout(() => {
      this.consecutiveCtrlC = 0;
    }, 1000);

    if (this.consecutiveCtrlC >= 2) {
      console.log(ui.warn('退出 LEA'));
      this.cleanup();
      process.exit(0);
      return;
    }

    if (this.abortController) {
      this.abortController.abort();
      console.log(ui.warn('操作已中断（再按 Ctrl+C 退出）'));
    } else {
      console.log(ui.warn('再按 Ctrl+C 退出'));
    }
  }

  private buildCommandContext(): CommandContext {
    return {
      llmClient: this.session.llmClient,
      config: this.session.config,
      persistence: this.session.persistence,
      projectDir: this.session.projectDir,
      engine: this.engine,
      onModelSwitch: (oldModel: string, newModel: string) => {
        this.statusBar.update({ model: newModel });
        this.subAgentManager?.configure(newModel, this.session.config.litellm.proxy_url);
        console.log(ui.model(`子代理模型已同步: ${newModel}`));
      },
    };
  }

  private cleanup(): void {
    this.statusBar.disable();
    this.rl.close();
    this.subAgentManager?.terminateAll();
    if (this.engine) {
      this.session.persistence.saveCheckpoint(this.engine.getState());
    }
  }
}
