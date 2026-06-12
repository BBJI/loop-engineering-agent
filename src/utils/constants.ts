export const VERSION = '0.1.0';

export const DEFAULT_STATE_DIR = '.lea/state';
export const DEFAULT_CONFIG_PATH = '.lea/config.yaml';
export const DEFAULT_SKILLS_DIR = 'skills';

export const PHASES = [
  'req',
  'design',
  'review',
  'task',
  'dev',
  'test',
] as const;

export type Phase = (typeof PHASES)[number];

export const MEMORY_THRESHOLDS = {
  warning: 512,
  critical: 768,
  fatal: 1024,
} as const;

export const COMPRESSION_THRESHOLD = 0.8;
export const HEARTBEAT_INTERVAL_MS = 60_000;
export const CHECKPOINT_INTERVAL_MS = 600_000;
