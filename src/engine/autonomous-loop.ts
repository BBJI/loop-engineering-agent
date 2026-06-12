import { EventEmitter } from 'events';
import type { Config } from '../model/types.js';
import type { LLMClient } from '../model/llm-client.js';
import type { WorkflowEngine, WorkflowState } from './workflow.js';
import type { PersistenceManager } from './persistence.js';
import type { ContextManager } from '../context/compression.js';
import type { SubAgentManager, SubAgentRequest } from '../context/sub-agent-manager.js';
import type { SkillEngine } from '../skill/skill-engine.js';
import type { PermissionManager } from '../security/permissions.js';
import type { Phase } from '../utils/constants.js';
import { ui, createSpinner } from '../utils/ui.js';

export interface LoopEvents {
  'phase:start': { phase: Phase; index: number };
  'phase:complete': { phase: Phase; artifacts: string[] };
  'checkpoint': { phase: Phase; artifacts: string[] };
  'bug:found': { round: number; count: number };
  'bug:fixed': { round: number; count: number };
  'escalate': { reason: string };
  'done': { state: WorkflowState };
  'progress': { message: string };
}

export class AutonomousLoop extends EventEmitter {
  private iteration = 0;
  private abortSignal?: AbortSignal;

  constructor(
    private engine: WorkflowEngine,
    private llmClient: LLMClient,
    private persistence: PersistenceManager,
    private contextManager: ContextManager,
    private subAgentManager: SubAgentManager,
    private skillEngine: SkillEngine,
    private permissionManager: PermissionManager,
    private config: Config
  ) {
    super();
  }

  setAbortSignal(signal: AbortSignal): void {
    this.abortSignal = signal;
  }

  async run(): Promise<WorkflowState> {
    while (true) {
      if (this.abortSignal?.aborted) {
        this.engine.getState().status = 'paused';
        break;
      }

      const state = this.engine.getState();

      if (state.status === 'completed' || state.status === 'failed') {
        break;
      }

      const currentPhase = this.engine.getCurrentPhase();

      this.emit('phase:start', { phase: currentPhase.name, index: state.currentPhaseIndex });
      console.log(ui.phase(`阶段: ${currentPhase.name}`));
      console.log('─'.repeat(40));

      await this.executePhase(currentPhase.name);

      if (this.abortSignal?.aborted) {
        this.engine.getState().status = 'paused';
        break;
      }

      if (this.engine.shouldPauseAtCheckpoint()) {
        const completedPhase = this.engine.getCurrentPhase();
        this.emit('checkpoint', { phase: completedPhase.name, artifacts: completedPhase.artifacts });
        console.log(ui.warn(`检查点: 阶段 "${currentPhase.name}" 已完成`));
        this.engine.getState().status = 'paused';
        break;
      }

      const canAdvance = this.engine.canAdvance();
      if (canAdvance.can) {
        this.engine.advancePhase();
      } else if (this.engine.isStable()) {
        this.engine.getState().status = 'completed';
      } else if (this.engine.shouldEscalate()) {
        this.emit('escalate', { reason: '收敛闭环不收敛' });
        console.log(ui.fail('收敛闭环不收敛，升级给用户'));
        break;
      }
    }

    const finalState = this.engine.getState();
    this.emit('done', { state: finalState });
    this.persistence.saveCheckpoint(finalState);
    return finalState;
  }

  private async executePhase(phase: Phase): Promise<void> {
    const spinner = createSpinner(`执行阶段: ${phase}...`);

    try {
      switch (phase) {
        case 'req':
        case 'design':
        case 'review':
        case 'task':
          await this.executeSkillPhase(phase, spinner);
          break;
        case 'dev':
          await this.executeDevPhase(spinner);
          break;
        case 'test':
          await this.executeTestPhase(spinner);
          break;
      }
    } catch (err: any) {
      spinner.fail(ui.fail(`阶段 ${phase} 执行失败: ${err.message}`));
      throw err;
    }
  }

  private async executeSkillPhase(phase: Phase, spinner: any): Promise<void> {
    spinner.start();

    const skillName = this.skillEngine.getSkillForPhase(phase);
    const state = this.engine.getState();
    const context = this.contextManager.buildContextForPhase(phase);

    const result = await this.skillEngine.executeSkill(
      skillName,
      state.description,
      context || undefined
    );

    spinner.succeed(ui.success(`阶段 ${phase} 完成`));

    const artifacts = this.extractArtifacts(result);
    this.engine.completePhase(artifacts);
    this.emit('phase:complete', { phase, artifacts });

    if (this.contextManager.needsCompression()) {
      console.log(ui.warn('上下文压缩中...'));
    }

    this.persistence.saveCheckpoint(this.engine.getState());
  }

  private async executeDevPhase(spinner: any): Promise<void> {
    const state = this.engine.getState();

    for (let iter = 1; iter <= state.maxIterations; iter++) {
      this.iteration = iter;
      spinner.start(`开发迭代 ${iter}/${state.maxIterations}...`);

      const taskRequest: SubAgentRequest = {
        task_id: `dev-iter-${iter}`,
        task_description: state.description,
        skill_name: 'dev-skill',
        skill_content: this.skillEngine.getSkill('dev-skill')?.content || '',
        context: {
          requirement_summary: this.contextManager.getSummary('req') as any,
          design_summary: this.contextManager.getSummary('design') as any,
          review_summary: this.contextManager.getSummary('review') as any,
          task_breakdown: this.contextManager.getSummary('task') as any,
        },
        files: [],
        permissions: {
          allow_write: this.config.permissions.allow_write,
          allow_command: this.config.permissions.allow_command,
          deny_commands: this.config.permissions.deny_commands,
        },
        constraints: {
          max_tokens: 8000,
          max_retries: 3,
          timeout_ms: 300_000,
        },
      };

      const result = await this.subAgentManager.executeTask(taskRequest);

      if (result.status === 'completed') {
        spinner.succeed(ui.success(`开发迭代 ${iter} 完成`));
        console.log(ui.agent(`子代理: ${result.summary.description}`));
      } else {
        spinner.fail(ui.fail(`开发迭代 ${iter} 失败: ${result.error?.message}`));
      }

      this.persistence.saveCheckpoint(this.engine.getState());
    }

    this.engine.completePhase([]);
  }

  private async executeTestPhase(spinner: any): Promise<void> {
    const state = this.engine.getState();
    const maxBugRounds = this.config.workflow.convergence.max_bug_rounds;

    for (let round = 1; round <= maxBugRounds + 1; round++) {
      spinner.start(`测试轮次 ${round}...`);

      const testRequest: SubAgentRequest = {
        task_id: `test-round-${round}`,
        task_description: `Run tests and report bugs for: ${state.description}`,
        skill_name: 'test-skill',
        skill_content: this.skillEngine.getSkill('test-skill')?.content || '',
        context: {
          requirement_summary: this.contextManager.getSummary('req') as any,
          design_summary: this.contextManager.getSummary('design') as any,
        },
        files: [],
        permissions: {
          allow_write: 'auto',
          allow_command: 'auto',
          deny_commands: this.config.permissions.deny_commands,
        },
        constraints: {
          max_tokens: 4000,
          max_retries: 2,
          timeout_ms: 180_000,
        },
      };

      const result = await this.subAgentManager.executeTask(testRequest);

      const bugsFound = result.summary.tests_failed;
      const bugsFixed = result.status === 'completed' ? result.summary.tests_passed : 0;

      this.engine.recordBugRound(bugsFound, bugsFixed);
      this.emit('bug:found', { round, count: bugsFound });
      this.emit('bug:fixed', { round, count: bugsFixed });
      spinner.succeed(ui.success(`测试轮次 ${round}: 发现 ${bugsFound} Bug, 修复 ${bugsFixed}`));

      if (this.engine.isStable()) {
        console.log(ui.success('迭代稳定，无新 Bug'));
        this.engine.completePhase([]);
        return;
      }

      if (this.engine.shouldEscalate()) {
        console.log(ui.warn('Bug 不收敛，需要人工介入'));
        return;
      }
    }

    this.engine.completePhase([]);
  }

  private extractArtifacts(result: string): string[] {
    const artifacts: string[] = [];
    const fileMatch = result.match(/###\s*FILE:\s*(.+)/g);
    if (fileMatch) {
      for (const m of fileMatch) {
        const path = m.replace(/###\s*FILE:\s*/, '').trim();
        artifacts.push(path);
      }
    }
    return artifacts;
  }
}
