import { loadConfig, getDefaultConfig } from './config.js';
import { configSchema, DEFAULT_CONFIG } from './model/types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Config', () => {
  test('默认配置有效', () => {
    const config = getDefaultConfig();
    expect(config.version).toBe(1);
    expect(config.models.default).toBe('glm-4');
    expect(config.workflow.autonomy).toBe('semi');
  });

  test('DEFAULT_CONFIG 导出与 getDefaultConfig 一致', () => {
    expect(getDefaultConfig()).toEqual(DEFAULT_CONFIG);
  });

  test('加载不存在的配置返回默认值', () => {
    const tmpDir = path.join(os.tmpdir(), `lea-test-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      const config = loadConfig(tmpDir);
      expect(config.version).toBe(1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('configSchema 解析完整配置', () => {
    const result = configSchema.safeParse(DEFAULT_CONFIG);
    expect(result.success).toBe(true);
  });
});
