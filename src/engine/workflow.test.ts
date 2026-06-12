import { WorkflowEngine } from '../engine/workflow.js';
import { DEFAULT_CONFIG } from '../model/types.js';

describe('WorkflowEngine', () => {
  let engine: WorkflowEngine;

  beforeEach(() => {
    engine = new WorkflowEngine('/tmp/test', '测试项目', DEFAULT_CONFIG);
  });

  test('初始状态应为运行中', () => {
    const state = engine.getState();
    expect(state.status).toBe('running');
    expect(state.currentPhaseIndex).toBe(0);
    expect(state.phases[0].name).toBe('req');
    expect(state.phases[0].status).toBe('pending');
  });

  test('完成当前阶段后可以推进', () => {
    engine.completePhase(['req-doc.md']);
    const { can, reason } = engine.canAdvance();
    expect(can).toBe(true);
    expect(reason).toBe('');
  });

  test('未完成阶段时不可推进', () => {
    const { can } = engine.canAdvance();
    expect(can).toBe(false);
  });

  test('推进到下一阶段', () => {
    engine.completePhase(['req-doc.md']);
    const next = engine.advancePhase();
    expect(next?.name).toBe('design');
    expect(next?.status).toBe('running');
  });

  test('阶段回退', () => {
    engine.completePhase(['req-doc.md']);
    engine.advancePhase();
    engine.completePhase(['design-spec.md']);

    engine.regressTo('req', '需求需要修改');
    const state = engine.getState();
    expect(state.currentPhaseIndex).toBe(0);
    expect(state.phases[0].status).toBe('running');
    expect(state.phases[1].status).toBe('pending');
  });

  test('检查点暂停 - 半自主模式', () => {
    expect(engine.shouldPauseAtCheckpoint()).toBe(true);
  });

  test('检查点不暂停 - 完全自主模式', () => {
    const config = { ...DEFAULT_CONFIG, workflow: { ...DEFAULT_CONFIG.workflow, autonomy: 'full' as const } };
    const autoEngine = new WorkflowEngine('/tmp/test', '测试', config);
    expect(autoEngine.shouldPauseAtCheckpoint()).toBe(false);
  });

  test('Bug 收敛检测', () => {
    engine.recordBugRound(8, 5);
    expect(engine.isConverging()).toBe(true);

    engine.recordBugRound(4, 3);
    expect(engine.isConverging()).toBe(true);
  });

  test('Bug 不收敛时升级', () => {
    engine.recordBugRound(5, 2);
    engine.recordBugRound(5, 2);
    engine.recordBugRound(5, 2);
    expect(engine.shouldEscalate()).toBe(true);
  });

  test('迭代稳定检测', () => {
    engine.recordBugRound(0, 0);
    engine.recordBugRound(0, 0);
    engine.recordBugRound(0, 0);
    expect(engine.isStable()).toBe(true);
  });
});
