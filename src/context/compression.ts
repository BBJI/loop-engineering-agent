import type { LLMClient } from '../model/llm-client.js';
import type { PersistenceManager } from '../engine/persistence.js';
import type { Phase } from '../utils/constants.js';
import { COMPRESSION_THRESHOLD } from '../utils/constants.js';

export interface PhaseSummary {
  phase: Phase;
  version: string;
  completed_at: string;
  artifacts: { path: string; type: 'document' | 'code' | 'test' | 'config'; description: string }[];
  key_decisions: { decision: string; rationale: string; requirement_ref: string }[];
  open_issues: { id: string; description: string; impact: string; status: 'pending' | 'deferred' }[];
  downstream_handoff: { phase: string; inputs: string[]; constraints: string[] };
  stats: { original_tokens: number; compressed_tokens: number; compression_ratio: number; model_used: string };
}

const COMPRESSION_PROMPT = `You are a context compression assistant. Compress the following phase execution history into a structured summary.

Requirements for the summary:
1. List all artifacts produced (files created/modified)
2. Extract key decisions made during this phase with rationale
3. List any open issues that remain unresolved
4. Define what the next downstream phase needs as input
5. Be precise and factual — do not add information not present in the source

Output your summary as a JSON object matching this structure:
{
  "artifacts": [{"path": "...", "type": "document|code|test|config", "description": "..."}],
  "key_decisions": [{"decision": "...", "rationale": "...", "requirement_ref": "FR-xxx"}],
  "open_issues": [{"id": "...", "description": "...", "impact": "...", "status": "pending|deferred"}],
  "downstream_handoff": {"phase": "...", "inputs": ["..."], "constraints": ["..."]}
}`;

export class ContextManager {
  private contextUsage = 0;
  private maxContext: number;
  private summaries: Map<Phase, PhaseSummary> = new Map();

  constructor(
    private llmClient: LLMClient,
    private persistence: PersistenceManager,
    maxContextTokens = 128000
  ) {
    this.maxContext = maxContextTokens;
  }

  getContextUsage(): number {
    return this.contextUsage;
  }

  getContextUsagePercent(): number {
    return this.contextUsage / this.maxContext;
  }

  addTokens(count: number): void {
    this.contextUsage += count;
  }

  needsCompression(): boolean {
    return this.getContextUsagePercent() >= COMPRESSION_THRESHOLD;
  }

  async compressPhase(
    phase: Phase,
    history: { role: string; content: string }[]
  ): Promise<PhaseSummary> {
    const historyText = history
      .map((h) => `[${h.role}]: ${h.content}`)
      .join('\n\n');

    const result = await this.llmClient.chatWithRetry(
      [
        { role: 'system', content: COMPRESSION_PROMPT },
        { role: 'user', content: `Phase: ${phase}\n\nHistory:\n${historyText}` },
      ],
      { taskType: 'complex_tasks', maxTokens: 4000, temperature: 0 }
    );

    let parsed: Record<string, unknown>;
    try {
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch {
      parsed = {};
    }

    const summary: PhaseSummary = {
      phase,
      version: '1.0',
      completed_at: new Date().toISOString(),
      artifacts: (parsed.artifacts as PhaseSummary['artifacts']) || [],
      key_decisions: (parsed.key_decisions as PhaseSummary['key_decisions']) || [],
      open_issues: (parsed.open_issues as PhaseSummary['open_issues']) || [],
      downstream_handoff: (parsed.downstream_handoff as PhaseSummary['downstream_handoff']) || {
        phase: '',
        inputs: [],
        constraints: [],
      },
      stats: {
        original_tokens: history.reduce((sum, h) => sum + Math.ceil(h.content.length / 4), 0),
        compressed_tokens: result.tokens.total,
        compression_ratio: 0,
        model_used: result.model,
      },
    };

    summary.stats.compression_ratio =
      summary.stats.original_tokens > 0
        ? summary.stats.compressed_tokens / summary.stats.original_tokens
        : 0;

    this.summaries.set(phase, summary);
    this.persistence.savePhaseHistory(phase, history);

    this.contextUsage = Math.max(0, this.contextUsage - summary.stats.original_tokens + summary.stats.compressed_tokens);

    return summary;
  }

  getSummary(phase: Phase): PhaseSummary | undefined {
    return this.summaries.get(phase);
  }

  getAllSummaries(): Map<Phase, PhaseSummary> {
    return new Map(this.summaries);
  }

  buildContextForPhase(targetPhase: Phase): string {
    const parts: string[] = [];

    for (const [phase, summary] of this.summaries) {
      parts.push(`## ${phase} Phase Summary`);
      parts.push(`Completed: ${summary.completed_at}`);
      parts.push(`Artifacts: ${summary.artifacts.map((a) => a.path).join(', ') || 'none'}`);
      parts.push(`Key Decisions: ${summary.key_decisions.map((d) => `${d.decision} (${d.requirement_ref})`).join('; ') || 'none'}`);
      if (summary.open_issues.length > 0) {
        parts.push(`Open Issues: ${summary.open_issues.map((i) => `${i.id}: ${i.description}`).join('; ')}`);
      }
      parts.push('');
    }

    return parts.join('\n');
  }
}
