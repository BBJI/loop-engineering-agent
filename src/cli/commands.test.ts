import { getCommand, getAllCommands } from './commands.js';
import { LLMClient } from '../model/llm-client.js';
import { DEFAULT_CONFIG, type Config } from '../model/types.js';

function makeCtx(config?: Partial<Config>) {
  const cfg = { ...JSON.parse(JSON.stringify(DEFAULT_CONFIG)), ...config } as Config;
  const llmClient = new LLMClient(cfg);
  return {
    llmClient,
    config: cfg,
    persistence: {
      listWorkflows: () => [],
      saveAuditLog: () => {},
      saveCheckpoint: () => {},
      init: () => {},
      loadLatestCheckpoint: () => null,
      savePhaseHistory: () => {},
    } as any,
    projectDir: '/tmp/test',
  };
}

describe('Slash commands', () => {
  test('/help returns command list', async () => {
    const cmd = getCommand('help')!;
    const result = await cmd.handler([], makeCtx());
    expect(result).toContain('可用命令');
  });

  test('/model shows current config', async () => {
    const cmd = getCommand('model')!;
    const result = await cmd.handler([], makeCtx());
    expect(result).toContain('默认: glm-4');
  });

  test('/model <name> switches model', async () => {
    const cmd = getCommand('model')!;
    const ctx = makeCtx();
    let switched = false;
    ctx.onModelSwitch = () => { switched = true; };
    const result = await cmd.handler(['deepseek-v3'], ctx);
    expect(result).toContain('deepseek-v3');
    expect(ctx.config.models.default).toBe('deepseek-v3');
    expect(switched).toBe(true);
  });

  test('/config autonomy switches mode', async () => {
    const cmd = getCommand('config')!;
    const result = await cmd.handler(['autonomy', 'full'], makeCtx());
    expect(result).toContain('autonomy = full');
  });

  test('/config budget sets daily limit', async () => {
    const cmd = getCommand('config')!;
    const result = await cmd.handler(['budget', '20'], makeCtx());
    expect(result).toContain('$20');
  });

  test('/budget shows spend', async () => {
    const cmd = getCommand('budget')!;
    const result = await cmd.handler([], makeCtx());
    expect(result).toContain('预算消耗');
  });

  test('/exit returns __EXIT__', async () => {
    const cmd = getCommand('exit')!;
    const result = await cmd.handler([], makeCtx());
    expect(result).toBe('__EXIT__');
  });

  test('/clear returns __CLEAR__', async () => {
    const cmd = getCommand('clear')!;
    const result = await cmd.handler([], makeCtx());
    expect(result).toBe('__CLEAR__');
  });

  test('/version returns version', async () => {
    const cmd = getCommand('version')!;
    const result = await cmd.handler([], makeCtx());
    expect(result).toContain('LEA v');
  });

  test('getAllCommands returns all commands', () => {
    const cmds = getAllCommands();
    expect(cmds.length).toBeGreaterThanOrEqual(10);
    expect(cmds.find((c) => c.name === 'help')).toBeTruthy();
    expect(cmds.find((c) => c.name === 'model')).toBeTruthy();
  });

  test('unknown command returns undefined', () => {
    expect(getCommand('nonexistent')).toBeUndefined();
  });
});
