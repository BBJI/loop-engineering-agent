import type { PersistenceManager } from '../engine/persistence.js';
import type { ContextManager } from '../context/compression.js';
import type { SubAgentManager } from '../context/sub-agent-manager.js';
import { MEMORY_THRESHOLDS, HEARTBEAT_INTERVAL_MS, CHECKPOINT_INTERVAL_MS } from '../utils/constants.js';
import type { WorkflowState } from '../engine/workflow.js';

export class StabilityGuard {
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private checkpointTimer: ReturnType<typeof setInterval> | null = null;
  private startTime = Date.now();

  constructor(
    private persistence: PersistenceManager,
    private contextManager: ContextManager,
    private subAgentManager: SubAgentManager,
    private getState: () => WorkflowState
  ) {}

  start(): void {
    this.startTime = Date.now();
    this.startHeartbeat();
    this.startPeriodicCheckpoint();
  }

  stop(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.checkpointTimer) clearInterval(this.checkpointTimer);
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      const mem = process.memoryUsage();
      const state = this.getState();

      this.persistence.saveHeartbeat({
        timestamp: Date.now(),
        phase: state.phases[state.currentPhaseIndex]?.name || 'unknown',
        taskId: undefined,
        memoryUsageMb: Math.round(mem.heapUsed / 1024 / 1024),
        contextUsagePct: Math.round(this.contextManager.getContextUsagePercent() * 100),
        modelCallsTotal: 0,
        elapsedSeconds: Math.round((Date.now() - this.startTime) / 1000),
      });

      this.checkMemoryPressure(mem.heapUsed);
    }, HEARTBEAT_INTERVAL_MS);
  }

  private startPeriodicCheckpoint(): void {
    this.checkpointTimer = setInterval(() => {
      const state = this.getState();
      this.persistence.saveCheckpoint(state);
    }, CHECKPOINT_INTERVAL_MS);
  }

  private checkMemoryPressure(heapUsed: number): void {
    const mb = heapUsed / 1024 / 1024;

    if (mb >= MEMORY_THRESHOLDS.fatal) {
      const state = this.getState();
      this.persistence.saveCheckpoint(state);
      console.error(`\n[FATAL] 内存超过 ${MEMORY_THRESHOLDS.fatal}MB，保存检查点并退出。使用 lea resume 恢复。`);
      process.exit(1);
    }

    if (mb >= MEMORY_THRESHOLDS.critical) {
      console.warn(`\n[CRITICAL] 内存 ${Math.round(mb)}MB，强制压缩和 GC...`);
      this.subAgentManager.terminateAll();
      if (global.gc) global.gc();
    }

    if (mb >= MEMORY_THRESHOLDS.warning) {
      console.warn(`\n[WARN] 内存 ${Math.round(mb)}MB，建议压缩上下文`);
    }
  }

  getElapsedSeconds(): number {
    return Math.round((Date.now() - this.startTime) / 1000);
  }

  getMemoryUsageMb(): number {
    return Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  }

  formatElapsed(): string {
    const s = this.getElapsedSeconds();
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h${m}m` : `${m}m${s % 60}s`;
  }

  renderDashboard(): string {
    const mem = this.getMemoryUsageMb();
    const ctx = Math.round(this.contextManager.getContextUsagePercent() * 100);
    const elapsed = this.formatElapsed();
    return `LEA | 运行 ${elapsed} | 内存 ${mem}MB | 上下文 ${ctx}%`;
  }
}
