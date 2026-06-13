import inquirer from 'inquirer';
import * as fs from 'fs';
import * as path from 'path';
import { saveConfig, loadConfig } from '../config.js';
import { DEFAULT_CONFIG, type Config } from '../model/types.js';
import { ui } from '../utils/ui.js';
import { VERSION } from '../utils/constants.js';

export function needsSetup(projectDir: string): boolean {
  const configPath = path.join(projectDir, '.lea', 'config.yaml');
  if (!fs.existsSync(configPath)) return true;

  try {
    const config = loadConfig(projectDir);
    // If all values are still defaults, treat as unconfigured
    return isDefaultConfig(config);
  } catch {
    return true;
  }
}

function isDefaultConfig(config: Config): boolean {
  return (
    config.models.default === DEFAULT_CONFIG.models.default &&
    config.models.fallback === DEFAULT_CONFIG.models.fallback &&
    config.litellm.proxy_url === DEFAULT_CONFIG.litellm.proxy_url &&
    !config.litellm.api_key
  );
}

export async function runSetupWizard(projectDir: string): Promise<Config> {
  console.log('');
  console.log(ui.bold(`  LEA v${VERSION} — Loop Engineering Agent`));
  console.log('  ════════════════════════════════════');
  console.log(ui.phase('  首次使用引导 — 配置模型和 API'));
  console.log('');

  const answers = await inquirer.prompt<SetupAnswers>([
    {
      type: 'list',
      name: 'provider',
      message: '选择模型接入方式:',
      choices: [
        { name: 'LiteLLM Proxy（统一代理，推荐）', value: 'litellm' },
        { name: '直连模型厂商 API', value: 'direct' },
        { name: '跳过配置（稍后用 /config 设置）', value: 'skip' },
      ],
      default: 'litellm',
    },
    {
      type: 'input',
      name: 'proxyUrl',
      message: 'LiteLLM Proxy 地址:',
      default: 'http://localhost:4000',
      when: (a) => a.provider === 'litellm',
      validate: (v: string) => {
        try { new URL(v); return true; } catch { return '请输入有效的 URL'; }
      },
    },
    {
      type: 'input',
      name: 'litellmApiKey',
      message: 'LiteLLM Proxy API Key（留空跳过）:',
      when: (a) => a.provider === 'litellm',
    },
    {
      type: 'input',
      name: 'directBaseUrl',
      message: 'API Base URL（如 https://api.openai.com/v1）:',
      default: 'https://api.openai.com/v1',
      when: (a) => a.provider === 'direct',
      validate: (v: string) => {
        try { new URL(v); return true; } catch { return '请输入有效的 URL'; }
      },
    },
    {
      type: 'input',
      name: 'directApiKey',
      message: 'API Key:',
      when: (a) => a.provider === 'direct',
      validate: (v: string) => v.trim() ? true : 'API Key 不能为空',
    },
    {
      type: 'input',
      name: 'defaultModel',
      message: '默认模型名称（如 gpt-4o, glm-4, deepseek-v3）:',
      default: 'glm-4',
      validate: (v: string) => v.trim() ? true : '模型名称不能为空',
    },
    {
      type: 'input',
      name: 'fallbackModel',
      message: '回退模型名称（主模型失败时使用，留空则无回退）:',
      default: 'deepseek-v3',
    },
    {
      type: 'list',
      name: 'autonomy',
      message: '选择自主级别:',
      choices: [
        { name: '半自主 — 阶段检查点暂停审批', value: 'semi' },
        { name: '完全自主 — 全程无需人工介入', value: 'full' },
        { name: '手动 — 每步需确认', value: 'manual' },
      ],
      default: 'semi',
    },
  ]);

  if (answers.provider === 'skip') {
    console.log(ui.warn('\n  配置已跳过。稍后可使用 /config 命令设置。'));
    return loadConfig(projectDir);
  }

  const config = buildConfig(answers);
  saveConfig(projectDir, config);

  console.log('');
  console.log(ui.success('  配置完成！已保存到 .lea/config.yaml'));
  console.log(`  默认模型: ${ui.model(config.models.default)}`);
  console.log(`  回退模型: ${ui.model(config.models.fallback || '无')}`);
  console.log(`  接入方式: ${config.litellm.proxy_url}`);
  if (config.litellm.api_key) {
    console.log(`  API Key:  ${config.litellm.api_key.substring(0, 4)}${'*'.repeat(Math.max(0, config.litellm.api_key.length - 4))}`);
  }
  console.log(ui.dim('  运行中可随时用 /model, /config 调整'));
  console.log('');

  return config;
}

interface SetupAnswers {
  provider: 'litellm' | 'direct' | 'skip';
  proxyUrl?: string;
  litellmApiKey?: string;
  directBaseUrl?: string;
  directApiKey?: string;
  defaultModel: string;
  fallbackModel: string;
  autonomy: 'full' | 'semi' | 'manual';
}

function buildConfig(answers: SetupAnswers): Config {
  const config: Config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

  if (answers.provider === 'litellm') {
    config.litellm.proxy_url = answers.proxyUrl || 'http://localhost:4000';
    config.litellm.api_key = answers.litellmApiKey || undefined;
  } else if (answers.provider === 'direct') {
    config.litellm.proxy_url = answers.directBaseUrl || 'https://api.openai.com/v1';
    config.litellm.api_key = answers.directApiKey;
  }

  config.models.default = answers.defaultModel.trim();
  config.models.fallback = answers.fallbackModel.trim() || config.models.fallback;
  config.workflow.autonomy = answers.autonomy;

  return config;
}
