import OpenAI from 'openai';
import type { Config } from './types.js';
import { ui } from '../utils/ui.js';

export interface ModelCallOptions {
  model?: string;
  taskType?: 'simple_tasks' | 'complex_tasks' | 'code_generation' | 'code_review';
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
}

export interface ModelCallResult {
  content: string;
  reasoning: string;
  model: string;
  tokens: { prompt: number; completion: number; total: number };
  cost: number;
  durationMs: number;
}

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'glm-4': { input: 0.0001, output: 0.0001 },
  'deepseek-v3': { input: 0.00027, output: 0.0011 },
  'deepseek-r1': { input: 0.00055, output: 0.00219 },
  'claude-4': { input: 0.003, output: 0.015 },
  'gpt-4o': { input: 0.0025, output: 0.01 },
};

export class LLMClient {
  private client: OpenAI;
  private config: Config;
  private dailySpend = 0;
  private dailySpendDate = new Date().toISOString().slice(0, 10);
  private callCount = 0;

  constructor(config: Config) {
    this.config = config;
    let baseURL = config.litellm.proxy_url.replace(/\/+$/, '');
    // Only append /v1 when the URL is a bare host (no path or just "/"),
    // e.g. "http://localhost:4000" → "http://localhost:4000/v1"
    // For URLs with a meaningful path (direct vendor APIs), trust as-is.
    const parsed = new URL(baseURL);
    if (parsed.pathname === '/' || parsed.pathname === '') {
      baseURL += '/v1';
    }
    this.client = new OpenAI({
      baseURL,
      apiKey: config.litellm.api_key || 'dummy',
    });
  }

  async chat(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    options: ModelCallOptions = {}
  ): Promise<ModelCallResult> {
    const model = this.selectModel(options);
    this.checkBudget();

    const start = Date.now();
    let content = '';

    let reasoning = '';
    let tokens = { prompt: 0, completion: 0, total: 0 };

    if (options.stream) {
      const stream = await this.client.chat.completions.create({
        model,
        messages,
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        stream: true,
        stream_options: { include_usage: true },
      });

      let inReasoning = false;
      let streamUsage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;
      for await (const chunk of stream) {
        // Capture usage from the final chunk
        if (chunk.usage) {
          streamUsage = chunk.usage;
        }
        const delta = chunk.choices[0]?.delta as any;
        // Handle reasoning_content for reasoning models (e.g. glm-5.1, deepseek-r1)
        if (delta?.reasoning_content) {
          if (!inReasoning) {
            process.stdout.write(ui.dim('思考: '));
            inReasoning = true;
          }
          reasoning += delta.reasoning_content;
          process.stdout.write(ui.dim(delta.reasoning_content));
        }
        if (delta?.content) {
          if (inReasoning) {
            process.stdout.write('\n\n');
            inReasoning = false;
          }
          content += delta.content;
          process.stdout.write(delta.content);
        }
      }
      process.stdout.write('\n');
      tokens = {
        prompt: streamUsage?.prompt_tokens || 0,
        completion: streamUsage?.completion_tokens || 0,
        total: streamUsage?.total_tokens || 0,
      };
    } else {
      const response = await this.client.chat.completions.create({
        model,
        messages,
        max_tokens: options.maxTokens,
        temperature: options.temperature,
      });
      const msg = response.choices[0]?.message as any;
      reasoning = msg?.reasoning_content || '';
      content = msg?.content || '';
      if (reasoning) {
        process.stdout.write(ui.dim(`思考: ${reasoning}\n\n`));
      }
      if (content) {
        process.stdout.write(content + '\n');
      }
      tokens = {
        prompt: response.usage?.prompt_tokens || 0,
        completion: response.usage?.completion_tokens || 0,
        total: response.usage?.total_tokens || 0,
      };
    }

    const durationMs = Date.now() - start;

    if (!content && !reasoning) {
      console.log(ui.warn('模型返回了空响应，请检查 API 地址是否为 OpenAI 兼容端点'));
    }

    const cost = this.estimateCost(model, tokens);

    this.dailySpend += cost;
    this.callCount++;

    const tokensDisplay = tokens.total >= 1000
      ? `${(tokens.total / 1000).toFixed(1)}k`
      : `${tokens.total}`;

    console.log(ui.model(
      `${model} | ${(durationMs / 1000).toFixed(1)}s | ${tokensDisplay} tokens | $${cost.toFixed(4)} | chat.completion`
    ));

    return { content, reasoning, model, tokens, cost, durationMs };
  }

  async chatWithRetry(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    options: ModelCallOptions = {},
    maxRetries = 3
  ): Promise<ModelCallResult> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          console.log(ui.warn(`重试 ${attempt}/${maxRetries}，${delay / 1000}s 后...`));
          await new Promise((r) => setTimeout(r, delay));
        }
        return await this.chat(messages, { ...options, model: options.model || undefined });
      } catch (err: any) {
        lastError = err;
        if (err?.status === 429 || err?.status >= 500) {
          continue;
        }
        if (attempt === 0 && this.config.models.fallback) {
          console.log(ui.warn(`主模型失败，尝试回退: ${this.config.models.fallback}`));
          try {
            return await this.chat(messages, { ...options, model: this.config.models.fallback });
          } catch {
            continue;
          }
        }
      }
    }
    throw lastError;
  }

  private selectModel(options: ModelCallOptions): string {
    if (options.model) return options.model;
    if (options.taskType && this.config.models.routing[options.taskType]) {
      return this.config.models.routing[options.taskType];
    }
    return this.config.models.default;
  }

  private checkBudget(): void {
    // Reset daily spend if the day has changed
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.dailySpendDate) {
      this.dailySpend = 0;
      this.dailySpendDate = today;
    }

    const budget = this.config.models.cost_budget;
    if (this.dailySpend >= budget.daily_limit) {
      throw new Error(
        `每日成本预算已耗尽: $${this.dailySpend.toFixed(2)} / $${budget.daily_limit}`
      );
    }
  }

  private estimateCost(model: string, tokens: { prompt: number; completion: number; total: number }): number {
    const pricing = MODEL_PRICING[model] || { input: 0.001, output: 0.002 };
    return (tokens.prompt * pricing.input + tokens.completion * pricing.output) / 1000;
  }

  getStats() {
    return { dailySpend: this.dailySpend, callCount: this.callCount };
  }

  switchModel(newModel: string): string {
    const old = this.config.models.default;
    this.config.models.default = newModel;
    return old;
  }

  switchFallback(newFallback: string): string {
    const old = this.config.models.fallback;
    this.config.models.fallback = newFallback;
    return old;
  }

  updateRouting(taskType: keyof Config['models']['routing'], model: string): void {
    this.config.models.routing[taskType] = model;
  }

  async listAvailableModels(): Promise<string[]> {
    try {
      const resp = await this.client.models.list();
      return resp.data.map((m) => m.id);
    } catch {
      return [this.config.models.default, this.config.models.fallback];
    }
  }

  getModelState() {
    return {
      default: this.config.models.default,
      fallback: this.config.models.fallback,
      routing: { ...this.config.models.routing },
      budget: {
        dailyLimit: this.config.models.cost_budget.daily_limit,
        dailySpend: this.dailySpend,
        perTaskLimit: this.config.models.cost_budget.per_task_limit,
      },
      callCount: this.callCount,
    };
  }
}
