import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { LLMClient } from '../model/llm-client.js';
import type { Phase } from '../utils/constants.js';

export interface SkillDefinition {
  name: string;
  description: string;
  content: string;
  references: { name: string; content: string }[];
  filePath: string;
}

export class SkillEngine {
  private skills: Map<string, SkillDefinition> = new Map();
  private skillsDir: string;

  constructor(
    skillsDir: string,
    private llmClient: LLMClient
  ) {
    this.skillsDir = skillsDir;
  }

  loadSkills(): SkillDefinition[] {
    this.skills.clear();

    // 1. Load built-in skills from the package's skills/ directory
    const builtinDir = this.getBuiltinSkillsDir();
    if (builtinDir && fs.existsSync(builtinDir)) {
      this.loadSkillsFromDir(builtinDir);
    }

    // 2. Load user skills (override built-in ones with same name)
    if (this.skillsDir && fs.existsSync(this.skillsDir)) {
      this.loadSkillsFromDir(this.skillsDir);
    }

    return Array.from(this.skills.values());
  }

  private getBuiltinSkillsDir(): string {
    try {
      // Resolve: <pkg_root>/dist/skill/skill-engine.js -> <pkg_root>/skills/
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      return path.resolve(__dirname, '..', '..', 'skills');
    } catch {
      return '';
    }
  }

  private loadSkillsFromDir(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillFile = path.join(dir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;

      const raw = fs.readFileSync(skillFile, 'utf-8');
      const skill = this.parseSkillMarkdown(raw, skillFile, entry.name);
      this.skills.set(skill.name, skill);
    }
  }

  private parseSkillMarkdown(
    raw: string,
    filePath: string,
    dirName: string
  ): SkillDefinition {
    const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---/);
    let name = dirName;
    let description = '';

    if (frontmatterMatch) {
      const fm = frontmatterMatch[1];
      const nameMatch = fm.match(/^name:\s*(.+)$/m);
      const descMatch = fm.match(/^description:\s*>?\n?([\s\S]*?)(?=\n\w|\n---)/m);

      if (nameMatch) name = nameMatch[1].trim();
      if (descMatch) description = descMatch[1].trim();
    }

    const content = raw.replace(/^---\n[\s\S]*?\n---\n?/, '');

    const references: { name: string; content: string }[] = [];
    const refDir = path.join(path.dirname(filePath), 'references');
    if (fs.existsSync(refDir)) {
      const refFiles = fs.readdirSync(refDir).filter((f: string) => f.endsWith('.md'));
      for (const refFile of refFiles) {
        const refContent = fs.readFileSync(path.join(refDir, refFile), 'utf-8');
        references.push({ name: refFile, content: refContent });
      }
    }

    return { name, description, content, references, filePath };
  }

  getSkill(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  listSkills(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  async executeSkill(
    skillName: string,
    input: string,
    context?: string
  ): Promise<string> {
    const skill = this.skills.get(skillName);
    if (!skill) {
      throw new Error(`技能 "${skillName}" 未找到。可用技能: ${Array.from(this.skills.keys()).join(', ')}`);
    }

    const systemPrompt = this.buildSystemPrompt(skill);
    const userPrompt = this.buildUserPrompt(skill, input, context);

    const result = await this.llmClient.chatWithRetry(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      { taskType: 'complex_tasks', temperature: 0.3 }
    );

    return result.content;
  }

  getSkillForPhase(phase: Phase): string {
    const phaseToSkill: Record<Phase, string> = {
      req: 'req-analysis-skill',
      design: 'design-skill',
      review: 'review-skill',
      task: 'task-allocation-skill',
      dev: 'dev-skill',
      test: 'test-skill',
    };
    return phaseToSkill[phase];
  }

  private buildSystemPrompt(skill: SkillDefinition): string {
    let prompt = skill.content;

    if (skill.references.length > 0) {
      prompt += '\n\n## Reference Materials\n';
      for (const ref of skill.references) {
        prompt += `\n### ${ref.name}\n${ref.content}\n`;
      }
    }

    return prompt;
  }

  private buildUserPrompt(
    skill: SkillDefinition,
    input: string,
    context?: string
  ): string {
    let prompt = `Execute skill "${skill.name}" with the following input:\n\n${input}`;

    if (context) {
      prompt += `\n\n## Additional Context\n${context}`;
    }

    return prompt;
  }
}
