import { Worker } from 'worker_threads';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { Phase } from '../utils/constants.js';
import type { PermissionAction } from '../model/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface SubAgentRequest {
  task_id: string;
  task_description: string;
  skill_name: string;
  skill_content: string;
  context: {
    requirement_summary?: Record<string, unknown>;
    design_summary?: Record<string, unknown>;
    review_summary?: Record<string, unknown>;
    task_breakdown?: Record<string, unknown>;
  };
  files: { path: string; content: string }[];
  permissions: {
    allow_write: PermissionAction;
    allow_command: PermissionAction;
    deny_commands: string[];
  };
  constraints: {
    max_tokens: number;
    max_retries: number;
    timeout_ms: number;
  };
  model?: string;
  proxyUrl?: string;
  apiKey?: string;
}

export interface SubAgentResult {
  task_id: string;
  status: 'completed' | 'failed' | 'timeout';
  summary: {
    description: string;
    files_modified: string[];
    files_created: string[];
    files_deleted: string[];
    tests_passed: number;
    tests_failed: number;
  };
  error?: {
    type: 'model_error' | 'execution_error' | 'timeout' | 'permission_denied';
    message: string;
    retry_count: number;
  };
  audit: {
    model_calls: number;
    total_tokens: number;
    total_cost: number;
    duration_ms: number;
  };
}

export class SubAgentManager {
  private workers: Map<string, Worker> = new Map();
  private model?: string;
  private proxyUrl?: string;
  private apiKey?: string;

  configure(model: string, proxyUrl: string, apiKey?: string): void {
    this.model = model;
    this.proxyUrl = proxyUrl;
    this.apiKey = apiKey;
  }

  async executeTask(request: SubAgentRequest): Promise<SubAgentResult> {
    if (!request.model) request.model = this.model;
    if (!request.proxyUrl) request.proxyUrl = this.proxyUrl;
    if (!request.apiKey) request.apiKey = this.apiKey;

    // Resolve worker path: prefer .js (compiled), fallback to .ts (dev mode with tsx)
    let workerPath = path.join(__dirname, 'sub-agent-worker.js');
    if (!fs.existsSync(workerPath)) {
      const tsPath = path.join(__dirname, 'sub-agent-worker.ts');
      if (fs.existsSync(tsPath)) {
        workerPath = tsPath;
      }
    }

    const workerOptions: Record<string, unknown> = {
      workerData: request,
      type: 'module',
    };
    const worker = new Worker(workerPath, workerOptions as any);

    this.workers.set(request.task_id, worker);

    const timeout = setTimeout(() => {
      worker.terminate();
    }, request.constraints.timeout_ms);

    let resolved = false;

    return new Promise((resolve) => {
      const resolveOnce = (result: SubAgentResult) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        this.workers.delete(request.task_id);
        resolve(result);
      };

      worker.on('message', (result: SubAgentResult) => {
        worker.terminate();
        resolveOnce(result);
      });

      worker.on('error', (err: Error) => {
        worker.terminate();
        resolveOnce({
          task_id: request.task_id,
          status: 'failed',
          summary: { description: `Worker error: ${err.message}`, files_modified: [], files_created: [], files_deleted: [], tests_passed: 0, tests_failed: 0 },
          error: { type: 'execution_error', message: err.message, retry_count: 0 },
          audit: { model_calls: 0, total_tokens: 0, total_cost: 0, duration_ms: 0 },
        });
      });

      worker.on('exit', (code) => {
        if (code !== 0) {
          resolveOnce({
            task_id: request.task_id,
            status: 'failed',
            summary: { description: `Worker exited with code ${code}`, files_modified: [], files_created: [], files_deleted: [], tests_passed: 0, tests_failed: 0 },
            error: { type: 'execution_error', message: `Exit code ${code}`, retry_count: 0 },
            audit: { model_calls: 0, total_tokens: 0, total_cost: 0, duration_ms: 0 },
          });
        } else {
          // Exit code 0 without message — resolve with empty failure
          resolveOnce({
            task_id: request.task_id,
            status: 'failed',
            summary: { description: 'Worker exited without sending result', files_modified: [], files_created: [], files_deleted: [], tests_passed: 0, tests_failed: 0 },
            error: { type: 'execution_error', message: 'No result from worker', retry_count: 0 },
            audit: { model_calls: 0, total_tokens: 0, total_cost: 0, duration_ms: 0 },
          });
        }
      });
    });
  }

  async executeTasksConcurrently(
    requests: SubAgentRequest[],
    maxConcurrency = 3
  ): Promise<SubAgentResult[]> {
    const results: SubAgentResult[] = [];
    const queue = [...requests];

    async function runNext(manager: SubAgentManager): Promise<void> {
      if (queue.length === 0) return;

      const request = queue.shift()!;
      const result = await manager.executeTask(request);
      results.push(result);
      await runNext(manager);
    }

    const concurrency = Math.min(maxConcurrency, requests.length);
    const runners = Array.from({ length: concurrency }, () => runNext(this));
    await Promise.all(runners);

    return results;
  }

  terminateAll(): void {
    for (const [, worker] of this.workers) {
      worker.terminate();
    }
    this.workers.clear();
  }

  getActiveCount(): number {
    return this.workers.size;
  }
}
