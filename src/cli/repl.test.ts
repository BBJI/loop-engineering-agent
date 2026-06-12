import { LLMClient } from '../model/llm-client.js';
import { DEFAULT_CONFIG, type Config } from '../model/types.js';

describe('LLMClient model hot-switch', () => {
  let client: LLMClient;
  let config: Config;

  beforeEach(() => {
    config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    client = new LLMClient(config);
  });

  test('switchModel changes default model', () => {
    const old = client.switchModel('deepseek-v3');
    expect(old).toBe('glm-4');
    expect(config.models.default).toBe('deepseek-v3');
  });

  test('switchFallback changes fallback model', () => {
    const old = client.switchFallback('gpt-4o');
    expect(old).toBe('deepseek-v3');
    expect(config.models.fallback).toBe('gpt-4o');
  });

  test('updateRouting changes routing entry', () => {
    client.updateRouting('code_generation', 'claude-4');
    expect(config.models.routing.code_generation).toBe('claude-4');
  });

  test('getModelState returns current state', () => {
    const state = client.getModelState();
    expect(state.default).toBe('glm-4');
    expect(state.fallback).toBe('deepseek-v3');
    expect(state.budget.dailyLimit).toBe(10.0);
    expect(state.callCount).toBe(0);
  });

  test('switchModel then getModelState reflects change', () => {
    client.switchModel('gpt-4o');
    const state = client.getModelState();
    expect(state.default).toBe('gpt-4o');
  });
});
