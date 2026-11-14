// OPTIONAL remote LLM provider (Anthropic Claude) driving the SAME allowlisted tools as the local copilot.
// The key is supplied by the user at runtime, kept only in this tab's memory, and never stored or bundled.
// The model may only act through validated tool calls; every number it reports must come from tool output.
import type Anthropic from '@anthropic-ai/sdk';
import { callTool, TOOLS, type Citation, type ToolCallLog, type ToolContext } from './tools';
import type { CopilotAnswer } from './copilot';
import { aeqdToLonLat } from '../core/coordinates';

export const LLM_MODEL = 'claude-opus-5-5';
let apiKey: string | null = null;
export function setLlmKey(key: string | null) { apiKey = key && key.trim() ? key.trim() : null; }
export function llmAvailable() { return !!apiKey; }

const SYSTEM = `You are the research copilot inside EGIZ ASTRAL, a planetary world-intelligence and rover mission-simulation instrument.
The loaded world is the Mons Mouton plateau near the lunar south pole, reconstructed from a measured PGDA LOLA 5 m DEM.
Rules:
- Use the provided tools for every quantitative statement (elevations, slopes, distances, energies, times, counts, statuses). Never estimate or invent numbers.
- Distinguish measured data, derived values, model outputs (heuristic, unvalidated), simulations, assumptions and unknowns, using the class labels the tools return.
- Never claim a feature that the data cannot resolve (e.g. individual boulders at 5 m posting) and never invent a citation; only cite sources the tools return.
- Model detections are candidates, not discoveries. ATLAS-Π statuses are authoritative for Earth-analog transferability.
- Map coordinates are metres east (x) and north (y) of the site centre.
Answer concisely: a few sentences, then let the tool results speak.`;

function contextSummary(ctx: ToolContext) {
  const sel = ctx.selection ? (ctx.selection.kind === 'object' ? `object ${ctx.selection.id}` : `point (${ctx.selection.x.toFixed(0)}, ${ctx.selection.y.toFixed(0)}) m`) : 'nothing';
  const o = ctx.world.manifest.referenceFrame.originLonLat, c = aeqdToLonLat(ctx.viewTarget.x, ctx.viewTarget.y, o[0], o[1], ctx.world.radius);
  return [`Studio context: world ${ctx.world.manifest.name}; selection: ${sel}; view centre (${ctx.viewTarget.x.toFixed(0)}, ${ctx.viewTarget.y.toFixed(0)}) m = ${c.lat.toFixed(4)}°, ${c.lon.toFixed(4)}°;`,
    `mission "${ctx.mission.name}": rover ${ctx.mission.roverId}, soil ${ctx.mission.soilId}, ${ctx.mission.waypoints.length} science stops, max slope ${ctx.mission.constraints.maxSlopeDeg}°, preferred ${ctx.mission.preferred};`,
    `routes planned: ${ctx.plan ? ctx.plan.routes.filter(r => r.feasible).length : 0}; active route: ${ctx.activeRouteId ?? 'none'}; scene time T+${(ctx.time / 3600).toFixed(1)} h after ${ctx.world.illumination.epochUtc}.`].join(' ');
}

export async function askLlm(text: string, ctx: ToolContext, history: Anthropic.Beta.BetaMessageParam[]): Promise<CopilotAnswer> {
  if (!apiKey) throw new Error('No API key configured for the optional LLM provider.');
  const { default: AnthropicClient } = await import('@anthropic-ai/sdk');
  const client = new AnthropicClient({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
  const tools: Anthropic.Beta.BetaTool[] = TOOLS.map(t => ({ name: t.name, description: t.description, input_schema: t.schema as Anthropic.Beta.BetaTool.InputSchema }));
  const log: ToolCallLog[] = [], citations: Citation[] = [];
  const answer: CopilotAnswer = { id: `l${Date.now()}`, request: text, provider: 'llm', headline: '', sections: [], citations, tools: log };
  history.push({ role: 'user', content: `${contextSummary(ctx)}\n\n${text}` });
  for (let turn = 0; turn < 8; turn++) {
    const response = await client.beta.messages.create({
      model: LLM_MODEL, max_tokens: 16000, system: SYSTEM, tools, messages: history,
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    });
    // Keep the full content (thinking blocks included) so later turns stay valid.
    history.push({ role: 'assistant', content: response.content as Anthropic.Beta.BetaContentBlockParam[] });
    if (response.stop_reason === 'refusal') { answer.declined = `The model declined (${response.stop_details?.category ?? 'unspecified'}).`; break; }
    const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    const textOut = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map(b => b.text).join('\n').trim();
    if (textOut) answer.narrative = textOut;
    if (response.stop_reason !== 'tool_use' || !uses.length) break;
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const u of uses) {
      const r = await callTool(ctx, u.name, u.input, log);
      answer.sections.push({ title: r.summary, ok: r.ok, facts: r.facts, notes: r.notes });
      citations.push(...r.citations);
      results.push({ type: 'tool_result', tool_use_id: u.id, is_error: !r.ok, content: JSON.stringify({ summary: r.summary, facts: r.facts, notes: r.notes, citations: r.citations.map(c => c.label) }) });
    }
    history.push({ role: 'user', content: results });
  }
  answer.citations = citations.filter((c, i, a) => a.findIndex(d => d.id === c.id) === i);
  answer.headline = answer.narrative?.split('\n')[0] ?? answer.sections.map(s => s.title).join(' ');
  return answer;
}
