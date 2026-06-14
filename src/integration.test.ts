import { WorkflowEngine } from './engine/workflow.js';
import { PersistenceManager } from './engine/persistence.js';
import { ArtifactManager } from './engine/artifacts.js';
import { ContextManager } from './context/compression.js';
import { PermissionManager } from './security/permissions.js';
import { DEFAULT_CONFIG } from './model/types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Integration: Workflow lifecycle', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `lea-integration-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('完整工作流状态流转: req→design→review', () => {
    const engine = new WorkflowEngine(tmpDir, '集成测试项目', DEFAULT_CONFIG);

    // 阶段1: req
    engine.completePhase(['req-doc.md']);
    expect(engine.canAdvance().can).toBe(true);

    // 阶段2: design
    engine.advancePhase();
    expect(engine.getCurrentPhase().name).toBe('design');
    engine.completePhase(['design-spec.md']);

    // 阶段3: review
    engine.advancePhase();
    expect(engine.getCurrentPhase().name).toBe('review');
    engine.completePhase(['review-report.md']);

    const state = engine.getState();
    expect(state.phases[0].status).toBe('completed');
    expect(state.phases[1].status).toBe('completed');
    expect(state.phases[2].status).toBe('completed');
    expect(state.phases[3].status).toBe('pending');
  });

  test('阶段回退清除后续状态', () => {
    const engine = new WorkflowEngine(tmpDir, '测试', DEFAULT_CONFIG);

    engine.completePhase(['req.md']);
    engine.advancePhase(); // design
    engine.completePhase(['design.md']);

    // 回退到 req
    engine.regressTo('req', '需求需要修改');

    const state = engine.getState();
    expect(state.currentPhaseIndex).toBe(0);
    expect(state.phases[0].status).toBe('running');
    expect(state.phases[1].status).toBe('pending');
    expect(state.phases[1].gatePassed).toBe(false);
  });

  test('检查点持久化和恢复', () => {
    const pm = new PersistenceManager(tmpDir, '.lea/state');
    pm.init();

    const engine = new WorkflowEngine(tmpDir, '持久化测试', DEFAULT_CONFIG);
    engine.completePhase(['req.md']);

    const state = engine.getState();
    pm.saveCheckpoint(state);

    const loaded = pm.loadLatestCheckpoint(state.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.state.phases[0].status).toBe('completed');
    expect(loaded!.state.phases[0].gatePassed).toBe(true);
  });

  test('制品版本管理', () => {
    const am = new ArtifactManager(tmpDir, '.lea/state');
    am.init();

    const v1 = am.saveArtifact('req', 'requirements.md', '# Requirements v1', '初始版本');
    const v2 = am.saveArtifact('req', 'requirements.md', '# Requirements v2\n\n新增NFR', '新增非功能需求');

    expect(v1).toBe(1);
    expect(v2).toBe(2);

    const diff = am.diff('req', 'requirements.md', 1, 2);
    expect(diff.old).toContain('v1');
    expect(diff.new).toContain('新增NFR');
  });

  test('权限控制集成', () => {
    const pm = new PersistenceManager(tmpDir, '.lea/state');
    pm.init();
    const perm = new PermissionManager(DEFAULT_CONFIG, pm);

    // 读取允许
    expect(perm.check({ type: 'file_read', target: 'src/main.ts' }).allowed).toBe(true);

    // 黑名单命令拒绝
    expect(perm.check({ type: 'command', target: 'rm -rf /' }).allowed).toBe(false);

    // 写入需确认
    expect(perm.check({ type: 'file_write', target: 'src/new.ts' }).allowed).toBe(false);

    // 授权后允许
    perm.grantAlways('write:src/new.ts');
    expect(perm.check({ type: 'file_write', target: 'src/new.ts' }).allowed).toBe(true);
  });

  test('Bug 收敛闭环', () => {
    const engine = new WorkflowEngine(tmpDir, '收敛测试', DEFAULT_CONFIG);

    // remaining 严格递减: 4 → 3 → 2 → 1 → 0 → 0 → 0
    engine.recordBugRound(10, 6); // remaining = 4
    expect(engine.isConverging()).toBe(true);

    engine.recordBugRound(3, 4);  // remaining = 3
    expect(engine.isConverging()).toBe(true);

    engine.recordBugRound(1, 2);  // remaining = 2
    expect(engine.isConverging()).toBe(true);

    engine.recordBugRound(0, 0);  // remaining = 2
    engine.recordBugRound(0, 1);  // remaining = 1
    engine.recordBugRound(0, 1);  // remaining = 0
    engine.recordBugRound(0, 0);
    engine.recordBugRound(0, 0);
    engine.recordBugRound(0, 0);
    expect(engine.isStable()).toBe(true);
  });

  test('Bug 不收敛升级', () => {
    const engine = new WorkflowEngine(tmpDir, '不收敛测试', DEFAULT_CONFIG);

    engine.recordBugRound(2, 1);  // remaining = 1
    engine.recordBugRound(3, 1);  // remaining = 3
    engine.recordBugRound(4, 1);  // remaining = 6

    expect(engine.shouldEscalate()).toBe(true);
  });
});
