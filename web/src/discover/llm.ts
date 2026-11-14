// Optional language-model provider for the Discover assistant, through the server-side proxy
// api/copilot.ts. The API key exists only on the server; the browser never sees it.
// The model can act only through the allowlisted tools in copilot.ts, which run HERE in the
// browser on the measured bundle; their outputs are the only source of numbers.
import { callTool, type Answer, type ToolContext } from './copilot';

const ENDPOINT = `${import.meta.env.BASE_URL}api/copilot`;
type Block = { type: string; id?: string; name?: string; input?: unknown; text?: string };
type Msg = { role: 'user' | 'assistant'; content: unknown };

export async function serverLlmStatus(): Promise<{ available: boolean; model?: string }> {
  const r = await fetch(ENDPOINT, { method: 'GET', headers: { accept: 'application/json' } });
  if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return { available: false };
  const j = await r.json() as { available?: boolean; model?: string };
  return { available: j.available === true, model: j.model };
}

function contextLine(ctx: ToolContext) {
  const sel = ctx.selected ? `selected Earth window ${ctx.selected}` : 'no window selected';
  return `Workspace context: target ${ctx.target.id} (${ctx.target.name}, ${ctx.target.body}); ${sel}; comparison tray ${ctx.compare.join(', ') || 'empty'}.`;
}

export async function askServerLlm(question: string, ctx: ToolContext): Promise<Answer> {
  const answer: Answer = { id: `l${Date.now()}`, question, provider: 'llm', results: [] };
  const messages: Msg[] = [{ role: 'user', content: `${contextLine(ctx)}\n\n${question}` }];
  for (let turn = 0; turn < 6; turn++) {
    const r = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages }) });
    if (!r.ok) throw new Error(`proxy HTTP ${r.status}`);
    const j = await r.json() as { content: Block[]; stop_reason: string; declined?: string };
    if (j.declined) { answer.error = j.declined; break; }
    messages.push({ role: 'assistant', content: j.content }); // full content, thinking blocks included
    const text = j.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    if (text) answer.narrative = text;
    const uses = j.content.filter(b => b.type === 'tool_use');
    if (j.stop_reason !== 'tool_use' || !uses.length) break;
    const results = uses.map(u => {
      const res = callTool(ctx, String(u.name), u.input);
      answer.results.push(res);
      return { type: 'tool_result', tool_use_id: u.id, is_error: !res.ok, content: JSON.stringify({ summary: res.summary, facts: res.facts, notes: res.notes }) };
    });
    messages.push({ role: 'user', content: results });
  }
  return answer;
}
