import { z } from 'zod';

const modelRoutingSchema = z.object({
  simple_tasks: z.string().default('deepseek-v3'),
  complex_tasks: z.string().default('glm-4'),
  code_generation: z.string().default('deepseek-v3'),
  code_review: z.string().default('claude-4'),
});

const costBudgetSchema = z.object({
  daily_limit: z.number().default(10.0),
  per_task_limit: z.number().default(2.0),
});

const litellmSchema = z.object({
  proxy_url: z.string().url().default('http://localhost:4000'),
  api_key: z.string().optional(),
});

const modelsSchema = z.object({
  default: z.string().default('glm-4'),
  fallback: z.string().default('deepseek-v3'),
  routing: modelRoutingSchema,
  cost_budget: costBudgetSchema,
});

const autonomySchema = z.enum(['full', 'semi', 'manual']);

const convergenceSchema = z.object({
  max_bug_rounds: z.number().default(3),
  stability_rounds: z.number().default(3),
});

const workflowSchema = z.object({
  autonomy: autonomySchema.default('semi'),
  checkpoints: z.array(z.string()).default(['req', 'design', 'review', 'test']),
  convergence: convergenceSchema,
});

const contextSchema = z.object({
  strategy: z.enum(['hybrid', 'compression', 'isolation']).default('hybrid'),
  compression_threshold: z.number().default(0.8),
  preserve_artifacts: z.boolean().default(true),
});

const permissionActionSchema = z.enum(['auto', 'ask', 'deny']);

const permissionsSchema = z.object({
  allow_read: z.boolean().default(true),
  allow_write: permissionActionSchema.default('ask'),
  allow_command: permissionActionSchema.default('ask'),
  deny_commands: z.array(z.string()).default(['rm -rf', 'git push --force', 'git reset --hard']),
});

const skillsSchema = z.object({
  directory: z.string().default('~/.lea/skills'),
  auto_discover: z.boolean().default(true),
});

const persistenceSchema = z.object({
  directory: z.string().default('.lea/state'),
  format: z.enum(['json', 'sqlite']).default('json'),
  auto_checkpoint: z.boolean().default(true),
});

export const configSchema = z.object({
  version: z.number().default(1),
  litellm: litellmSchema,
  models: modelsSchema,
  workflow: workflowSchema,
  context: contextSchema,
  permissions: permissionsSchema,
  skills: skillsSchema,
  persistence: persistenceSchema,
});

export type Config = z.infer<typeof configSchema>;
export type AutonomyLevel = z.infer<typeof autonomySchema>;
export type PermissionAction = z.infer<typeof permissionActionSchema>;

export const DEFAULT_CONFIG: Config = {
  version: 1,
  litellm: { proxy_url: 'http://localhost:4000' },
  models: {
    default: 'glm-4',
    fallback: 'deepseek-v3',
    routing: { simple_tasks: 'deepseek-v3', complex_tasks: 'glm-4', code_generation: 'deepseek-v3', code_review: 'claude-4' },
    cost_budget: { daily_limit: 10.0, per_task_limit: 2.0 },
  },
  workflow: {
    autonomy: 'semi',
    checkpoints: ['req', 'design', 'review', 'test'],
    convergence: { max_bug_rounds: 3, stability_rounds: 3 },
  },
  context: { strategy: 'hybrid', compression_threshold: 0.8, preserve_artifacts: true },
  permissions: { allow_read: true, allow_write: 'ask', allow_command: 'ask', deny_commands: ['rm -rf', 'git push --force', 'git reset --hard'] },
  skills: { directory: '~/.lea/skills', auto_discover: true },
  persistence: { directory: '.lea/state', format: 'json', auto_checkpoint: true },
};
