import { parentPort, workerData } from 'worker_threads';
import OpenAI from 'openai';
import * as fs from 'fs';
import type { SubAgentRequest, SubAgentResult } from './sub-agent-manager.js';

const request: SubAgentRequest = workerData;
const startTime = Date.now();

async function run(): Promise<void> {
  let modelCalls = 0;
  let totalTokens = 0;
  let totalCost = 0;

  try {
    const client = new OpenAI({
      baseURL: request.proxyUrl || process.env.LITELLM_PROXY_URL || 'http://localhost:4000',
    });

    const systemPrompt = buildSystemPrompt(request);
    const userPrompt = buildUserPrompt(request);

    let content = '';
    let retries = 0;

    while (retries <= request.constraints.max_retries) {
      try {
        const response = await client.chat.completions.create({
          model: request.model || process.env.DEFAULT_MODEL || 'glm-4',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: request.constraints.max_tokens,
        });

        content = response.choices[0]?.message?.content || '';
        totalTokens = response.usage?.total_tokens || 0;
        modelCalls++;
        break;
      } catch (err: any) {
        retries++;
        if (retries > request.constraints.max_retries) {
          throw err;
        }
        const delay = Math.min(1000 * Math.pow(2, retries - 1), 10000);
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    const { created, modified } = extractFileOperations(content);

    for (const fileOp of [...created, ...modified]) {
      if (request.permissions.allow_write === 'auto' || request.permissions.allow_write === 'ask') {
        const dir = fileOp.path.substring(0, fileOp.path.lastIndexOf('/'));
        if (dir && !fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(fileOp.path, fileOp.content, 'utf-8');
      }
    }

    const result: SubAgentResult = {
      task_id: request.task_id,
      status: 'completed',
      summary: {
        description: content.substring(0, 200),
        files_modified: modified.map((f) => f.path),
        files_created: created.map((f) => f.path),
        files_deleted: [],
        tests_passed: 0,
        tests_failed: 0,
      },
      audit: {
        model_calls: modelCalls,
        total_tokens: totalTokens,
        total_cost: totalCost,
        duration_ms: Date.now() - startTime,
      },
    };

    parentPort?.postMessage(result);
  } catch (err: any) {
    const result: SubAgentResult = {
      task_id: request.task_id,
      status: 'failed',
      summary: {
        description: `Task failed: ${err.message}`,
        files_modified: [],
        files_created: [],
        files_deleted: [],
        tests_passed: 0,
        tests_failed: 0,
      },
      error: {
        type: 'execution_error',
        message: err.message,
        retry_count: 0,
      },
      audit: {
        model_calls: modelCalls,
        total_tokens: totalTokens,
        total_cost: totalCost,
        duration_ms: Date.now() - startTime,
      },
    };

    parentPort?.postMessage(result);
  }
}

function buildSystemPrompt(req: SubAgentRequest): string {
  return `You are an autonomous coding agent executing task "${req.task_id}".

Skill: ${req.skill_name}

${req.skill_content}

Rules:
- Follow the skill instructions precisely
- Produce complete, working code
- Handle errors gracefully
- Write only the files needed for this task`;
}

function buildUserPrompt(req: SubAgentRequest): string {
  let prompt = `Task: ${req.task_description}\n\n`;

  if (req.context.requirement_summary) {
    prompt += `## Requirement Context\n${JSON.stringify(req.context.requirement_summary, null, 2)}\n\n`;
  }

  if (req.context.design_summary) {
    prompt += `## Design Context\n${JSON.stringify(req.context.design_summary, null, 2)}\n\n`;
  }

  if (req.files.length > 0) {
    prompt += `## Existing Files\n`;
    for (const file of req.files) {
      prompt += `### ${file.path}\n\`\`\`\n${file.content}\n\`\`\`\n\n`;
    }
  }

  prompt += `Execute this task now. Provide file contents in the format:\n### FILE: path/to/file\n\`\`\`\n// content\n\`\`\`\n`;
  return prompt;
}

function extractFileOperations(
  content: string
): { created: { path: string; content: string }[]; modified: { path: string; content: string }[] } {
  const created: { path: string; content: string }[] = [];
  const modified: { path: string; content: string }[] = [];

  const createRegex = /###\s*(?:CREATE|NEW\s+FILE|FILE):\s*(.+)\n```[\s\S]*?\n([\s\S]*?)```/g;
  const modifyRegex = /###\s*(?:MODIFY|UPDATE|EDIT):\s*(.+)\n```[\s\S]*?\n([\s\S]*?)```/g;

  let match;
  while ((match = createRegex.exec(content)) !== null) {
    created.push({ path: match[1].trim(), content: match[2].trim() });
  }
  while ((match = modifyRegex.exec(content)) !== null) {
    modified.push({ path: match[1].trim(), content: match[2].trim() });
  }

  if (created.length === 0 && modified.length === 0) {
    const fallbackRegex = /###\s*FILE:\s*(.+)\n```[\s\S]*?\n([\s\S]*?)```/g;
    while ((match = fallbackRegex.exec(content)) !== null) {
      created.push({ path: match[1].trim(), content: match[2].trim() });
    }
  }

  return { created, modified };
}

run();
