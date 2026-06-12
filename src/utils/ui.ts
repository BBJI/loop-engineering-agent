import chalk from 'chalk';
import ora, { type Ora } from 'ora';

const ICONS = {
  phase: '◆',
  task: '▶',
  success: '✓',
  fail: '✗',
  bug: '⚑',
  model: '◈',
  agent: '◎',
  skill: '◇',
  warn: '△',
  progress: '○',
};

const FALLBACK = {
  phase: '[*]',
  task: '>',
  success: 'OK',
  fail: 'FAIL',
  bug: '[BUG]',
  model: '[M]',
  agent: '[A]',
  skill: '[S]',
  warn: '[!]',
  progress: '-',
};

let useNerdFont = true;

export function detectNerdFont(): boolean {
  const term = process.env.TERM || '';
  const termProgram = process.env.TERM_PROGRAM || '';
  useNerdFont = termProgram === 'iTerm.app' ||
    termProgram === 'Hyper' ||
    term.includes('xterm') ||
    term.includes('alacritty') ||
    process.env.WT_SESSION !== undefined;
  return useNerdFont;
}

function icon(name: keyof typeof ICONS): string {
  return useNerdFont ? ICONS[name] : FALLBACK[name];
}

export const ui = {
  phase: (msg: string) => chalk.blue(`${icon('phase')} ${msg}`),
  task: (msg: string) => chalk.cyan(`${icon('task')} ${msg}`),
  success: (msg: string) => chalk.green(`${icon('success')} ${msg}`),
  fail: (msg: string) => chalk.red(`${icon('fail')} ${msg}`),
  bug: (msg: string) => chalk.red(`${icon('bug')} ${msg}`),
  model: (msg: string) => chalk.magenta(`${icon('model')} ${msg}`),
  agent: (msg: string) => chalk.magenta(`${icon('agent')} ${msg}`),
  skill: (msg: string) => chalk.blue(`${icon('skill')} ${msg}`),
  warn: (msg: string) => chalk.yellow(`${icon('warn')} ${msg}`),
  dim: (msg: string) => chalk.dim(msg),
  bold: (msg: string) => chalk.bold(msg),
};

export function createSpinner(text: string): Ora {
  return ora({ text, spinner: 'dots' });
}

export function renderProgressBar(
  label: string,
  current: number,
  total: number,
  width = 20
): string {
  const pct = total > 0 ? current / total : 0;
  const filled = Math.round(pct * width);
  const empty = width - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  return `${label} ${bar} ${Math.round(pct * 100)}% (${current}/${total})`;
}

export function renderStatusPanel(data: {
  project: string;
  phase: string;
  phaseIndex: number;
  totalPhases: number;
  iteration: number;
  phases: { name: string; status: string }[];
  bugTrend?: { current: number; previous: number };
  model?: string;
  contextPct?: number;
}): string {
  const lines: string[] = [];
  const w = Math.min(process.stdout.columns || 80, 60);

  lines.push('┌' + '─'.repeat(w - 2) + '┐');
  lines.push(`│  LEA 工作流状态${' '.repeat(w - 16) }│`);
  lines.push(`│  项目: ${data.project}${' '.repeat(Math.max(0, w - 8 - data.project.length - 2))}│`);
  lines.push('├' + '─'.repeat(w - 2) + '┤');

  for (const p of data.phases) {
    const statusIcon =
      p.status === 'completed' ? chalk.green('✓') :
      p.status === 'running' ? chalk.cyan('○') :
      chalk.dim('-');
    const statusText =
      p.status === 'completed' ? chalk.green('已完成') :
      p.status === 'running' ? chalk.cyan('进行中') :
      chalk.dim('待开始');
    const line = `│  ${statusIcon} ${p.name}  ${statusText}`;
    lines.push(line + ' '.repeat(Math.max(0, w - line.length - 1)) + '│');
  }

  lines.push('├' + '─'.repeat(w - 2) + '┤');
  let info = '│  ';
  if (data.bugTrend) {
    const arrow = data.bugTrend.current < data.bugTrend.previous ? ' ↓' :
      data.bugTrend.current > data.bugTrend.previous ? ' ↑' : ' →';
    info += `Bug: ${data.bugTrend.current}${arrow}  `;
  }
  if (data.model) {
    info += `模型: ${data.model}  `;
  }
  if (data.contextPct !== undefined) {
    info += `上下文: ${data.contextPct}%  `;
  }
  lines.push(info + ' '.repeat(Math.max(0, w - info.length - 1)) + '│');
  lines.push('┘' + '─'.repeat(w - 2) + '┘');

  return lines.join('\n');
}

detectNerdFont();
