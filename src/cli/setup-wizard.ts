import inquirer from 'inquirer';
import * as fs from 'fs';
import * as path from 'path';
import { saveConfig, loadConfig } from '../config.js';
import { DEFAULT_CONFIG, type Config } from '../model/types.js';
import { ui } from '../utils/ui.js';
import { VERSION } from '../utils/constants.js';

const VENDOR_PRESETS: Record<string, { name: string; url: string; models: string[] }> = {
  zhipu: {
    name: '智谱 AI (GLM)',
    url: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-5.1', 'glm-5', 'glm-4', 'glm-4-flash'],
  },
  deepseek: {
    name: 'DeepSeek',
    url: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  moonshot: {
    name: '月之暗面 (Moonshot)',
    url: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
  },
  qwen: {
    name: '阿里通义 (Qwen)',
    url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-turbo', 'qwen-plus', 'qwen-max'],
  },
  openai: {
    name: 'OpenAI',
    url: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
  },
  anthropic: {
    name: 'Anthropic',
    url: 'https://api.anthropic.com/v1',
    models: ['claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001'],
  },
};

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

  const questions: any[] = [
    {
      type: 'list',
      name: 'provider',
      message: '选择模型接入方式:',
      choices: [
        { name: '直连模型厂商 API', value: 'direct' },
        { name: 'LiteLLM Proxy（统一代理）', value: 'litellm' },
        { name: '跳过配置（稍后用 /config 设置）', value: 'skip' },
      ],
      default: 'direct',
    },
    // --- Vendor selection for direct mode ---
    {
      type: 'list',
      name: 'vendor',
      message: '选择模型厂商:',
      choices: [
        ...Object.entries(VENDOR_PRESETS).map(([key, v]) => ({
          name: v.name,
          value: key,
        })),
        { name: '自定义（手动输入 URL）', value: 'custom' },
      ],
      when: (a: any) => a.provider === 'direct',
    },
    {
      type: 'input',
      name: 'customBaseUrl',
      message: 'OpenAI 兼容 API Base URL:',
      when: (a: any) => a.provider === 'direct' && a.vendor === 'custom',
      validate: (v: string) => {
        try { new URL(v); return true; } catch { return '请输入有效的 URL'; }
      },
    },
    {
      type: 'input',
      name: 'directApiKey',
      message: 'API Key:',
      when: (a: any) => a.provider === 'direct',
      validate: (v: string) => v.trim() ? true : 'API Key 不能为空',
    },
    {
      type: 'list',
      name: 'defaultModel',
      message: '选择默认模型:',
      choices: (a: any) => {
        const vendor = VENDOR_PRESETS[a.vendor as string];
        if (vendor) {
          return vendor.models.map((m: string) => ({ name: m, value: m }));
        }
        return [];
      },
      when: (a: any) => a.provider === 'direct' && a.vendor !== 'custom' && a.vendor && VENDOR_PRESETS[a.vendor as string],
    },
    {
      type: 'input',
      name: 'customDefaultModel',
      message: '默认模型名称（如 gpt-4o, glm-4）:',
      when: (a: any) => a.provider === 'direct' && (a.vendor === 'custom' || !(a.vendor && VENDOR_PRESETS[a.vendor as string])),
      validate: (v: string) => v.trim() ? true : '模型名称不能为空',
    },
    {
      type: 'input',
      name: 'fallbackModel',
      message: '回退模型名称（主模型失败时使用，留空则无回退）:',
      default: '',
      when: (a: any) => a.provider === 'direct',
    },
    // --- LiteLLM Proxy ---
    {
      type: 'input',
      name: 'proxyUrl',
      message: 'LiteLLM Proxy 地址:',
      default: 'http://localhost:4000',
      when: (a: any) => a.provider === 'litellm',
      validate: (v: string) => {
        try { new URL(v); return true; } catch { return '请输入有效的 URL'; }
      },
    },
    {
      type: 'input',
      name: 'litellmApiKey',
      message: 'LiteLLM Proxy API Key（留空跳过）:',
      when: (a: any) => a.provider === 'litellm',
    },
    {
      type: 'input',
      name: 'litellmDefaultModel',
      message: '默认模型名称:',
      default: 'gpt-4o',
      when: (a: any) => a.provider === 'litellm',
      validate: (v: string) => v.trim() ? true : '模型名称不能为空',
    },
    {
      type: 'input',
      name: 'litellmFallbackModel',
      message: '回退模型名称（留空则无回退）:',
      default: '',
      when: (a: any) => a.provider === 'litellm',
    },
    // --- Common ---
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
  ];

  const answers = await inquirer.prompt<SetupAnswers>(questions);

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
  console.log(`  API 地址: ${config.litellm.proxy_url}`);
  if (config.litellm.api_key) {
    console.log(`  API Key:  ${config.litellm.api_key.substring(0, 4)}${'*'.repeat(Math.max(0, config.litellm.api_key.length - 4))}`);
  }
  console.log(ui.dim('  运行中可随时用 /model, /config 调整'));
  console.log('');

  return config;
}

interface SetupAnswers {
  provider: 'litellm' | 'direct' | 'skip';
  vendor?: string;
  customBaseUrl?: string;
  directApiKey?: string;
  defaultModel?: string;
  customDefaultModel?: string;
  fallbackModel?: string;
  proxyUrl?: string;
  litellmApiKey?: string;
  litellmDefaultModel?: string;
  litellmFallbackModel?: string;
  autonomy: 'full' | 'semi' | 'manual';
}

function buildConfig(answers: SetupAnswers): Config {
  const config: Config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

  if (answers.provider === 'litellm') {
    config.litellm.proxy_url = answers.proxyUrl || 'http://localhost:4000';
    config.litellm.api_key = answers.litellmApiKey || undefined;
    config.models.default = (answers.litellmDefaultModel || 'gpt-4o').trim();
    config.models.fallback = (answers.litellmFallbackModel || '').trim() || config.models.fallback;
  } else if (answers.provider === 'direct') {
    const vendor = VENDOR_PRESETS[answers.vendor || ''];
    if (vendor) {
      config.litellm.proxy_url = vendor.url;
    } else {
      config.litellm.proxy_url = answers.customBaseUrl || 'https://api.openai.com/v1';
    }
    config.litellm.api_key = answers.directApiKey;
    config.models.default = (answers.defaultModel || answers.customDefaultModel || 'gpt-4o').trim();
    config.models.fallback = (answers.fallbackModel || '').trim() || config.models.fallback;
  }

  config.workflow.autonomy = answers.autonomy;

  return config;
}
