import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { configSchema, DEFAULT_CONFIG, type Config } from './model/types.js';

export function loadConfig(projectDir: string): Config {
  const configPath = path.join(projectDir, '.lea', 'config.yaml');

  if (!fs.existsSync(configPath)) {
    return DEFAULT_CONFIG;
  }

  const raw = fs.readFileSync(configPath, 'utf-8');
  const parsed = yaml.load(raw);

  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    const errors = result.error.issues.map(
      (i) => `  ${i.path.join('.')}: ${i.message}`
    );
    throw new Error(`配置文件无效:\n${errors.join('\n')}`);
  }

  return result.data;
}

export function saveConfig(projectDir: string, config: Config): void {
  const configDir = path.join(projectDir, '.lea');
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  const configPath = path.join(configDir, 'config.yaml');
  const content = yaml.dump(config, { lineWidth: -1 });

  const tmpPath = configPath + '.tmp';
  fs.writeFileSync(tmpPath, content, 'utf-8');
  fs.renameSync(tmpPath, configPath);
}

export function getDefaultConfig(): Config {
  return DEFAULT_CONFIG;
}

export { type Config };
