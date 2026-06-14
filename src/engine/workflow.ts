import { PHASES, type Phase } from '../utils/constants.js';
import type { Config, AutonomyLevel } from '../model/types.js';

export type PhaseStatus = 'pending' | 'running' | 'completed' | 'blocked';

export interface WorkflowPhase {
  name: Phase;
  status: PhaseStatus;
  startedAt?: string;
  completedAt?: string;
  artifacts: string[];
  gatePassed: boolean;
}

export interface WorkflowState {
  id: string;
  projectDir: string;
  description: string;
  phases: WorkflowPhase[];
  currentPhaseIndex: number;
  currentIteration: number;
  maxIterations: number;
  bugHistory: { round: number; found: number; fixed: number; remaining: number }[];
  status: 'running' | 'paused' | 'completed' | 'failed';
  autonomy: AutonomyLevel;
  createdAt: string;
  updatedAt: string;
}

export interface GateCondition {
  phase: Phase;
  check: (state: WorkflowState) => { passed: boolean; message: string };
}

const GATE_CONDITIONS: Record<Phase, (state: WorkflowState) => { passed: boolean; message: string }> = {
  req: () => ({ passed: true, message: '' }),
  design: (state) => {
    const reqPhase = state.phases.find((p) => p.name === 'req');
    return reqPhase?.gatePassed
      ? { passed: true, message: '' }
      : { passed: false, message: '需求分析阶段未通过门控' };
  },
  review: (state) => {
    const designPhase = state.phases.find((p) => p.name === 'design');
    return designPhase?.gatePassed
      ? { passed: true, message: '' }
      : { passed: false, message: '设计阶段未通过门控' };
  },
  task: (state) => {
    const reviewPhase = state.phases.find((p) => p.name === 'review');
    return reviewPhase?.gatePassed
      ? { passed: true, message: '' }
      : { passed: false, message: '评估阶段未通过门控' };
  },
  dev: (state) => {
    const taskPhase = state.phases.find((p) => p.name === 'task');
    return taskPhase?.gatePassed
      ? { passed: true, message: '' }
      : { passed: false, message: '任务拆分阶段未通过门控' };
  },
  test: (state) => {
    const devPhase = state.phases.find((p) => p.name === 'dev');
    return devPhase?.gatePassed
      ? { passed: true, message: '' }
      : { passed: false, message: '开发阶段未通过门控' };
  },
};

export class WorkflowEngine {
  private state: WorkflowState;
  private config: Config;

  constructor(projectDir: string, description: string, config: Config) {
    this.config = config;
    this.state = {
      id: `wf-${Date.now()}`,
      projectDir,
      description,
      phases: PHASES.map((name) => ({
        name,
        status: 'pending' as PhaseStatus,
        artifacts: [],
        gatePassed: false,
      })),
      currentPhaseIndex: 0,
      currentIteration: 1,
      maxIterations: 4,
      bugHistory: [],
      status: 'running',
      autonomy: config.workflow.autonomy,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  getState(): WorkflowState {
    return JSON.parse(JSON.stringify(this.state));
  }

  setStatus(status: WorkflowState['status']): void {
    this.state.status = status;
    this.state.updatedAt = new Date().toISOString();
  }

  getCurrentPhase(): WorkflowPhase {
    return this.state.phases[this.state.currentPhaseIndex];
  }

  canAdvance(): { can: boolean; reason: string } {
    const current = this.getCurrentPhase();
    if (current.status !== 'completed' || !current.gatePassed) {
      return { can: false, reason: `当前阶段 "${current.name}" 未完成或未通过门控` };
    }

    const nextIndex = this.state.currentPhaseIndex + 1;
    if (nextIndex >= this.state.phases.length) {
      return { can: false, reason: '已是最后阶段' };
    }

    const nextPhase = this.state.phases[nextIndex];
    const gate = GATE_CONDITIONS[nextPhase.name](this.state);
    return { can: gate.passed, reason: gate.message };
  }

  advancePhase(): WorkflowPhase | null {
    const { can, reason } = this.canAdvance();
    if (!can) {
      throw new Error(`无法推进: ${reason}`);
    }

    this.state.currentPhaseIndex++;
    const next = this.state.phases[this.state.currentPhaseIndex];
    next.status = 'running';
    next.startedAt = new Date().toISOString();
    this.state.updatedAt = new Date().toISOString();
    return next;
  }

  completePhase(artifacts: string[]): void {
    const current = this.getCurrentPhase();
    current.status = 'completed';
    current.completedAt = new Date().toISOString();
    current.artifacts = artifacts;
    current.gatePassed = true;
    this.state.updatedAt = new Date().toISOString();
  }

  regressTo(phaseName: Phase, reason: string): void {
    const targetIndex = this.state.phases.findIndex((p) => p.name === phaseName);
    if (targetIndex < 0) {
      throw new Error(`阶段 "${phaseName}" 不存在`);
    }

    for (let i = targetIndex; i < this.state.phases.length; i++) {
      const p = this.state.phases[i];
      p.status = 'pending';
      p.gatePassed = false;
      p.artifacts = [];
      p.startedAt = undefined;
      p.completedAt = undefined;
    }

    this.state.currentPhaseIndex = targetIndex;
    this.state.phases[targetIndex].status = 'running';
    this.state.phases[targetIndex].startedAt = new Date().toISOString();
    this.state.updatedAt = new Date().toISOString();
  }

  shouldPauseAtCheckpoint(): boolean {
    if (this.state.autonomy === 'full') return false;
    if (this.state.autonomy === 'manual') return true;

    const current = this.getCurrentPhase();
    return this.config.workflow.checkpoints.includes(current.name);
  }

  recordBugRound(found: number, fixed: number): void {
    const round = this.state.bugHistory.length + 1;
    const prevRemaining = this.state.bugHistory.length > 0
      ? this.state.bugHistory[this.state.bugHistory.length - 1].remaining
      : found;
    const remaining = prevRemaining - fixed + (found - (this.state.bugHistory.length > 0 ? 0 : found));

    this.state.bugHistory.push({
      round,
      found,
      fixed,
      remaining: Math.max(0, found - fixed + (prevRemaining - found > 0 ? prevRemaining - found : 0)),
    });
  }

  isConverging(): boolean {
    const history = this.state.bugHistory;
    if (history.length < 2) return true;

    const last3 = history.slice(-3);
    const bugCounts = last3.map((h) => h.remaining);

    for (let i = 1; i < bugCounts.length; i++) {
      if (bugCounts[i] >= bugCounts[i - 1]) return false;
    }
    return true;
  }

  isStable(): boolean {
    const history = this.state.bugHistory;
    const stabilityRounds = this.config.workflow.convergence.stability_rounds;

    if (history.length < stabilityRounds) return false;

    const recent = history.slice(-stabilityRounds);
    return recent.every((h) => h.remaining === 0);
  }

  isLastPhaseCompleted(): boolean {
    const current = this.getCurrentPhase();
    const isLast = this.state.currentPhaseIndex === this.state.phases.length - 1;
    return isLast && current.status === 'completed';
  }

  shouldEscalate(): boolean {
    const history = this.state.bugHistory;
    const maxRounds = this.config.workflow.convergence.max_bug_rounds;

    if (history.length < maxRounds) return false;
    return !this.isConverging();
  }
}
