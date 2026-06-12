import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { needsSetup } from './setup-wizard.js';
import { saveConfig } from '../config.js';
import { DEFAULT_CONFIG } from '../model/types.js';

describe('setup-wizard', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lea-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('needsSetup returns true when no config file exists', () => {
    expect(needsSetup(tmpDir)).toBe(true);
  });

  test('needsSetup returns true when config has all defaults', () => {
    saveConfig(tmpDir, JSON.parse(JSON.stringify(DEFAULT_CONFIG)));
    expect(needsSetup(tmpDir)).toBe(true);
  });

  test('needsSetup returns false when config has been customized', () => {
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    config.litellm.api_key = 'sk-test-key-12345';
    saveConfig(tmpDir, config);
    expect(needsSetup(tmpDir)).toBe(false);
  });

  test('needsSetup returns false when default model is changed', () => {
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    config.models.default = 'deepseek-v3';
    saveConfig(tmpDir, config);
    expect(needsSetup(tmpDir)).toBe(false);
  });

  test('needsSetup returns false when proxy_url is changed', () => {
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    config.litellm.proxy_url = 'https://api.deepseek.com/v1';
    saveConfig(tmpDir, config);
    expect(needsSetup(tmpDir)).toBe(false);
  });

  test('needsSetup returns true for corrupted config', () => {
    const configDir = path.join(tmpDir, '.lea');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.yaml'), '{{invalid yaml}}');
    expect(needsSetup(tmpDir)).toBe(true);
  });
});
