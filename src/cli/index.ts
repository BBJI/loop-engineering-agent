#!/usr/bin/env node
import { Command } from 'commander';
import * as path from 'path';
import { VERSION } from '../utils/constants.js';
import { loadConfig, saveConfig, getDefaultConfig } from '../config.js';
import type { Config } from '../model/types.js';
import { LLMClient } from '../model/llm-client.js';
import { WorkflowEngine } from '../engine/workflow.js';
import { PersistenceManager } from '../engine/persistence.js';
import { ContextManager } from '../context/compression.js';
import { SubAgentManager } from '../context/sub-agent-manager.js';
import { SkillEngine } from '../skill/skill-engine.js';
import { PermissionManager } from '../security/permissions.js';
import { AutonomousLoop } from '../engine/autonomous-loop.js';
import { ui, createSpinner, renderStatusPanel } from '../utils/ui.js';
import { REPL } from './repl.js';
import { needsSetup, runSetupWizard } from './setup-wizard.js';

const program = new Command();

program
  .name('lea')
  .description('Loop Engineering Agent — 自主编程智能体')
  .version(VERSION);

program
  .command('version')
  .description('显示版本信息')
  .action(() => {
    console.log(`LEA v${VERSION}`);
  });

program
  .command('run')
  .description('启动工作流')
  .argument('[description]', '项目需求描述')
  .option('--model <name>', '指定模型')
  .option('--auto', '完全自主模式')
  .option('--checkpoint <list>', '检查点列表（逗号分隔）')
  .option('--verbose', '详细输出')
  .option('--dry-run', '预演模式')
  .option('--project <path>', '项目目录', process.cwd())
  .action(async (description: string, opts: any) => {
    if (!description) {
      console.log(ui.fail('请提供项目需求描述'));
      process.exit(1);
    }

    try {
      const projectDir = path.resolve(opts.project);

      let config: Config;
      if (needsSetup(projectDir)) {
        console.log(ui.phase('首次使用，先完成基础配置：'));
        config = await runSetupWizard(projectDir);
      } else {
        config = loadConfig(projectDir);
      }

      if (opts.auto) config.workflow.autonomy = 'full';
      if (opts.checkpoint) {
        config.workflow.checkpoints = opts.checkpoint.split(',');
      }

      console.log(ui.phase('初始化工作流...'));

      const spinner = createSpinner('加载模块...');
      spinner.start();

      const persistence = new PersistenceManager(projectDir, config.persistence.directory);
      persistence.init();

      const llmClient = new LLMClient(config);
      const skillEngine = new SkillEngine(
        config.skills.directory.replace('~', process.env.HOME || '~'),
        llmClient
      );
      const loadedSkills = skillEngine.loadSkills();
      spinner.succeed(ui.success(`加载技能: ${loadedSkills.length} 个技能已加载`));

      const engine = new WorkflowEngine(projectDir, description, config);
      const contextManager = new ContextManager(llmClient, persistence);
      const subAgentManager = new SubAgentManager();
      const permissionManager = new PermissionManager(config, persistence);

      if (opts.dryRun) {
        console.log(ui.warn('预演模式 — 不执行实际操作'));
        console.log(renderStatusPanel({
          project: path.basename(projectDir),
          phase: engine.getCurrentPhase().name,
          phaseIndex: 0,
          totalPhases: 6,
          iteration: 1,
          phases: engine.getState().phases.map((p) => ({
            name: p.name,
            status: p.status,
          })),
          model: config.models.default,
        }));
        return;
      }

      console.log(ui.model(`连接模型: ${config.models.default} (通过 LiteLLM Proxy)`));
      console.log(ui.phase(`上下文策略: ${config.context.strategy}`));

      const loop = new AutonomousLoop(
        engine, llmClient, persistence, contextManager,
        subAgentManager, skillEngine, permissionManager, config
      );

      const finalState = await loop.run();

      console.log('\n' + renderStatusPanel({
        project: path.basename(projectDir),
        phase: finalState.phases[finalState.currentPhaseIndex]?.name || '—',
        phaseIndex: finalState.currentPhaseIndex,
        totalPhases: finalState.phases.length,
        iteration: finalState.currentIteration,
        phases: finalState.phases.map((p) => ({
          name: p.name,
          status: p.status === 'completed' ? 'completed' :
                  p.status === 'running' ? 'running' : 'pending',
        })),
        model: config.models.default,
        contextPct: Math.round(contextManager.getContextUsagePercent() * 100),
      }));

      if (finalState.status === 'completed') {
        console.log(ui.success('工作流已完成'));
      } else if (finalState.status === 'paused') {
        console.log(ui.warn('工作流已暂停，使用 lea resume 继续'));
      }
    } catch (err: any) {
      console.error(ui.fail(`错误: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command('resume')
  .description('恢复中断的工作流')
  .argument('[id]', '工作流 ID')
  .option('--project <path>', '项目目录', process.cwd())
  .action(async (id: string, opts: any) => {
    const projectDir = path.resolve(opts.project);
    const config = loadConfig(projectDir);
    const persistence = new PersistenceManager(projectDir, config.persistence.directory);

    if (id) {
      const checkpoint = persistence.loadLatestCheckpoint(id);
      if (!checkpoint) {
        console.log(ui.fail(`工作流 ${id} 未找到`));
        return;
      }
      console.log(ui.success(`恢复工作流: ${id}`));
    } else {
      const workflows = persistence.listWorkflows();
      if (workflows.length === 0) {
        console.log(ui.warn('无可恢复的工作流'));
        return;
      }

      console.log(ui.phase('发现未完成的工作流:'));
      workflows.forEach((w, i) => {
        console.log(`  #${i + 1}  ${w.id}  ${w.description.substring(0, 40)}  ${w.status}  ${w.updatedAt}`);
      });
    }
  });

program
  .command('status')
  .description('查看工作流状态')
  .option('--project <path>', '项目目录', process.cwd())
  .action((opts: any) => {
    const projectDir = path.resolve(opts.project);
    const config = loadConfig(projectDir);
    const persistence = new PersistenceManager(projectDir, config.persistence.directory);

    const workflows = persistence.listWorkflows();
    if (workflows.length === 0) {
      console.log(ui.dim('暂无工作流'));
      return;
    }

    for (const w of workflows) {
      console.log(`  ${w.id}  ${w.description.substring(0, 50)}  ${w.status}`);
    }
  });

program
  .command('skills')
  .description('列出可用技能')
  .option('--project <path>', '项目目录', process.cwd())
  .action((opts: any) => {
    const config = loadConfig(path.resolve(opts.project));
    const llmClient = new LLMClient(config);
    const skillEngine = new SkillEngine(
      config.skills.directory.replace('~', process.env.HOME || '~'),
      llmClient
    );

    const skills = skillEngine.loadSkills();
    if (skills.length === 0) {
      console.log(ui.warn('未找到技能文件'));
      console.log(ui.dim(`技能目录: ${config.skills.directory}`));
      return;
    }

    console.log(ui.phase(`已加载 ${skills.length} 个技能:`));
    for (const skill of skills) {
      console.log(`  ${ui.skill(skill.name)} — ${skill.description.substring(0, 60)}`);
    }
  });

program
  .command('config')
  .description('管理配置')
  .addCommand(
    new Command('init')
      .description('初始化配置文件')
      .option('--project <path>', '项目目录', process.cwd())
      .action(async (opts: any) => {
        const projectDir = path.resolve(opts.project);
        await runSetupWizard(projectDir);
      })
  )
  .addCommand(
    new Command('model')
      .description('管理模型配置')
      .option('--project <path>', '项目目录', process.cwd())
      .action((opts: any) => {
        const config = loadConfig(path.resolve(opts.project));
        console.log(ui.phase('当前模型配置:'));
        console.log(`  默认: ${config.models.default}`);
        console.log(`  回退: ${config.models.fallback}`);
        console.log(`  路由: ${JSON.stringify(config.models.routing)}`);
        console.log(`  预算: $${config.models.cost_budget.daily_limit}/天, $${config.models.cost_budget.per_task_limit}/任务`);
      })
  );

program
  .command('compact')
  .description('手动触发上下文压缩')
  .action(() => {
    console.log(ui.warn('上下文压缩仅在运行中的工作流内有效'));
  });

program
  .command('list')
  .description('列出所有工作流')
  .option('--project <path>', '项目目录', process.cwd())
  .action((opts: any) => {
    const config = loadConfig(path.resolve(opts.project));
    const persistence = new PersistenceManager(path.resolve(opts.project), config.persistence.directory);
    const workflows = persistence.listWorkflows();

    if (workflows.length === 0) {
      console.log(ui.dim('暂无工作流'));
      return;
    }

    for (const w of workflows) {
      console.log(`  ${w.id}  ${w.status}  ${w.updatedAt}`);
    }
  });

program.parse();

// When no subcommand is given, launch REPL
const subCommands = ['run', 'resume', 'status', 'skills', 'config', 'compact', 'list', 'version'];
const firstArg = process.argv[2];
if (!firstArg || !subCommands.includes(firstArg)) {
  if (!firstArg || firstArg.startsWith('-')) {
    // No subcommand — start interactive REPL
    const projectDir = process.cwd();

    let config: Config;
    if (needsSetup(projectDir)) {
      config = await runSetupWizard(projectDir);
    } else {
      config = loadConfig(projectDir);
    }

    const persistence = new PersistenceManager(projectDir, config.persistence.directory);
    persistence.init();
    const llmClient = new LLMClient(config);

    const repl = new REPL({ llmClient, config, persistence, projectDir });
    repl.start().catch((err) => {
      console.error(ui.fail(`REPL 错误: ${err.message}`));
      process.exit(1);
    });
  }
}
