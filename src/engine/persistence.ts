import * as fs from 'fs';
import * as path from 'path';
import type { WorkflowState } from './workflow.js';

const SCHEMA_VERSION = 1;

export interface Checkpoint {
  schema_version: number;
  saved_at: string;
  state: WorkflowState;
}

export class PersistenceManager {
  private stateDir: string;

  constructor(projectDir: string, stateDir: string) {
    this.stateDir = path.join(projectDir, stateDir);
  }

  init(): void {
    if (!fs.existsSync(this.stateDir)) {
      fs.mkdirSync(this.stateDir, { recursive: true });
    }
  }

  saveCheckpoint(state: WorkflowState): string {
    this.init();

    const checkpoint: Checkpoint = {
      schema_version: SCHEMA_VERSION,
      saved_at: new Date().toISOString(),
      state,
    };

    const filename = `checkpoint-${state.id}-${Date.now()}.json`;
    const filePath = path.join(this.stateDir, filename);
    const tmpPath = filePath + '.tmp';

    fs.writeFileSync(tmpPath, JSON.stringify(checkpoint, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);

    return filePath;
  }

  loadLatestCheckpoint(workflowId: string): Checkpoint | null {
    this.init();

    const files = fs
      .readdirSync(this.stateDir)
      .filter((f: string) => f.startsWith(`checkpoint-${workflowId}-`) && f.endsWith('.json'))
      .sort();

    for (let i = files.length - 1; i >= 0; i--) {
      const filePath = path.join(this.stateDir, files[i]);
      const checkpoint = this.loadCheckpoint(filePath);
      if (checkpoint) return checkpoint;
    }

    return null;
  }

  loadCheckpoint(filePath: string): Checkpoint | null {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const checkpoint: Checkpoint = JSON.parse(raw);

      if (checkpoint.schema_version !== SCHEMA_VERSION) {
        return null;
      }

      if (!checkpoint.state || !checkpoint.state.id) {
        return null;
      }

      return checkpoint;
    } catch {
      return null;
    }
  }

  listWorkflows(): { id: string; description: string; status: string; updatedAt: string }[] {
    this.init();

    const files = fs.readdirSync(this.stateDir).filter((f: string) => f.startsWith('checkpoint-'));
    const seen = new Map<string, { id: string; description: string; status: string; updatedAt: string }>();

    for (const file of files) {
      const filePath = path.join(this.stateDir, file);
      const cp = this.loadCheckpoint(filePath);
      if (cp && !seen.has(cp.state.id)) {
        seen.set(cp.state.id, {
          id: cp.state.id,
          description: cp.state.description,
          status: cp.state.status,
          updatedAt: cp.saved_at,
        });
      }
    }

    return Array.from(seen.values());
  }

  savePhaseHistory(phaseName: string, history: object[]): void {
    this.init();
    const filePath = path.join(this.stateDir, `phase-${phaseName}-history.jsonl`);
    const line = JSON.stringify({ timestamp: new Date().toISOString(), ...history }) + '\n';
    fs.appendFileSync(filePath, line, 'utf-8');
  }

  saveAuditLog(entry: {
    timestamp: string;
    type: string;
    target: string;
    result: string;
  }): void {
    this.init();
    const filePath = path.join(this.stateDir, 'audit.jsonl');
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(filePath, line, 'utf-8');
  }

  saveHeartbeat(data: {
    timestamp: number;
    phase: string;
    taskId?: string;
    memoryUsageMb: number;
    contextUsagePct: number;
    modelCallsTotal: number;
    elapsedSeconds: number;
  }): void {
    this.init();
    const filePath = path.join(this.stateDir, 'heartbeat.json');
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  }

  loadHeartbeat(): typeof undefined | {
    timestamp: number;
    phase: string;
  } {
    const filePath = path.join(this.stateDir, 'heartbeat.json');
    if (!fs.existsSync(filePath)) return undefined;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      return undefined;
    }
  }
}
