import { PersistenceManager } from '../engine/persistence.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DEFAULT_CONFIG } from '../model/types.js';
import type { WorkflowState } from '../engine/workflow.js';

describe('PersistenceManager', () => {
  let pm: PersistenceManager;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `lea-persist-test-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    pm = new PersistenceManager(tmpDir, '.lea/state');
    pm.init();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  function makeState(id: string): WorkflowState {
    return {
      id,
      projectDir: tmpDir,
      description: '测试工作流',
      phases: [
        { name: 'req', status: 'completed', artifacts: ['req.md'], gatePassed: true, startedAt: '2026-01-01', completedAt: '2026-01-01' },
        { name: 'design', status: 'running', artifacts: [], gatePassed: false, startedAt: '2026-01-01' },
        { name: 'review', status: 'pending', artifacts: [], gatePassed: false },
        { name: 'task', status: 'pending', artifacts: [], gatePassed: false },
        { name: 'dev', status: 'pending', artifacts: [], gatePassed: false },
        { name: 'test', status: 'pending', artifacts: [], gatePassed: false },
      ],
      currentPhaseIndex: 1,
      currentIteration: 1,
      maxIterations: 4,
      bugHistory: [],
      status: 'running',
      autonomy: 'semi',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    };
  }

  test('保存和加载检查点', () => {
    const state = makeState('wf-test-001');
    pm.saveCheckpoint(state);

    const loaded = pm.loadLatestCheckpoint('wf-test-001');
    expect(loaded).not.toBeNull();
    expect(loaded!.state.id).toBe('wf-test-001');
    expect(loaded!.state.currentPhaseIndex).toBe(1);
  });

  test('列出工作流', () => {
    pm.saveCheckpoint(makeState('wf-001'));
    pm.saveCheckpoint(makeState('wf-002'));

    const workflows = pm.listWorkflows();
    expect(workflows.length).toBeGreaterThanOrEqual(2);
  });

  test('加载不存在的检查点返回 null', () => {
    const loaded = pm.loadLatestCheckpoint('nonexistent');
    expect(loaded).toBeNull();
  });

  test('审计日志写入', () => {
    pm.saveAuditLog({
      timestamp: new Date().toISOString(),
      type: 'file_write',
      target: 'src/main.ts',
      result: 'allowed',
    });

    const logPath = path.join(tmpDir, '.lea/state/audit.jsonl');
    expect(fs.existsSync(logPath)).toBe(true);
    const content = fs.readFileSync(logPath, 'utf-8').trim();
    expect(content).toContain('file_write');
  });

  test('心跳写入', () => {
    pm.saveHeartbeat({
      timestamp: Date.now(),
      phase: 'dev',
      memoryUsageMb: 256,
      contextUsagePct: 45,
      modelCallsTotal: 10,
      elapsedSeconds: 600,
    });

    const hb = pm.loadHeartbeat();
    expect(hb).not.toBeUndefined();
    expect(hb!.phase).toBe('dev');
  });
});
