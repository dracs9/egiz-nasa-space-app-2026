// Contextual research copilot. The local provider maps a request to typed tool calls with a documented
// grammar; an optional LLM provider (llm.ts) can drive the same tools. Answers are assembled from tool
// results only and keep measured / derived / model / simulated / assumed / unknown content separate.
import { searchKnowledge } from './knowledge';
import { callTool, type Citation, type Fact, type ToolCallLog, type ToolContext } from './tools';

export interface CopilotAnswer {
  id: string; request: string; provider: 'local' | 'llm'; headline: string;
  sections: { title: string; ok: boolean; facts: Fact[]; notes: string[] }[];
  citations: Citation[]; tools: ToolCallLog[]; declined?: string; narrative?: string;
}
export interface PlannedCall { tool: string; args: Record<string, unknown> }

const N: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, half: 0.5, twice: 2, double: 2 };

/** Deterministic request → tool-call plan. Returns [] when the request is outside the grammar. */
export function planCalls(text: string, ctx: Pick<ToolContext, 'selection' | 'plan'>): PlannedCall[] {
  const t = text.toLowerCase().trim(), calls: PlannedCall[] = [];
  const id = t.match(/\b(crater-\d{4}|anomaly-\d{3})\b/)?.[1];
  const region = /whole site|entire site|everywhere/.test(t) ? 'site' : /operational|5 ?m box|mission area/.test(t) ? 'operational' : /around (this|the selected|here)|near (this|here)|this (area|point|location|crater)|selected/.test(t) && ctx.selection ? 'selection' : 'view';
  let m: RegExpMatchArray | null;
  if (/\b(help|what can you do|capabilit)/.test(t)) return [];
  if ((m = t.match(/\b(?:fly|go|zoom|navigate|take me|move)\b.*?\bto\b\s+(.+)$/))) {
    const target = m[1].trim();
    if (/jezero|mars|earth|bozjyra|boszhira/.test(target)) return [{ tool: '__unsupported_target', args: { target } }];
    calls.push({ tool: 'set_view', args: { target: id ?? (/start|landing/.test(target) ? 'start' : /destination|goal|end/.test(target) ? 'destination' : /select/.test(target) ? 'selection' : 'site') } });
    return calls;
  }
  if ((m = t.match(/slopes?\s+(?:above|over|greater than|steeper than|exceeding|>)\s*(\d+(?:\.\d+)?)/)) && /\b(show|highlight|display|mark|map)\b/.test(t))
    return [{ tool: 'set_view', args: { overlay: 'hazard', slopeLimitDeg: Number(m[1]) } }, { tool: 'find_features', args: { kind: 'hazards', region, slopeAboveDeg: Number(m[1]) } }];
  if (/\bshow\b.*\b(slope map|slopes)\b/.test(t)) return [{ tool: 'set_view', args: { overlay: 'slope' } }];
  if (/\b(terrain )?units?\b/.test(t) && /\b(show|map|which|what)\b/.test(t)) return [{ tool: 'find_features', args: { kind: 'units', region } }];
  if (/(plan|create|design|build|make|propose).*(mission|survey|traverse|route)|avoid\w* slopes|energy reserve|science stops?/.test(t) && !/explain|why/.test(t)) {
    if (/route to (this|the selected)/.test(t) || /(mission|survey|traverse|stops?|reserve|avoid)/.test(t)) calls.push({ tool: 'propose_mission', args: { request: text } });
    calls.push({ tool: 'plan_routes', args: {} });
    return calls;
  }
  if (/route to (this|the selected|my selected)|go to (this|the selected) (point|observation)/.test(t)) return [{ tool: 'propose_mission', args: { request: text } }, { tool: 'plan_routes', args: {} }];
  if (/\b(start|run|begin|launch|play)\b.*\b(sim|simulation|rover|traverse|playback)/.test(t)) {
    const obj = /safe|risk/.test(t) ? 'safest' : /energy/.test(t) ? 'energy' : /short/.test(t) ? 'shortest' : /sun|illum/.test(t) ? 'illumination' : undefined;
    return [{ tool: 'run_simulation', args: obj ? { objective: obj } : {} }];
  }
  if (/\b(local )?noon\b/.test(t)) return [{ tool: 'set_time', args: { mode: 'local_noon' } }];
  if ((m = t.match(/(?:advance|forward|move) (?:the )?time (?:by )?(-?\d+) ?h/))) return [{ tool: 'set_time', args: { mode: 'hours_from_now', hours: Number(m[1]) } }];
  if (/what (changes|happens|if)|what-if|if the rover had|smaller|larger|bigger|halve|double/.test(t) && /(battery|energy|mass|heavier|lighter|speed|faster|slower|soil|regolith|rover|fidelity|later|earlier)/.test(t)) {
    const factor = /half|halve|smaller|lower|less|lighter|slower/.test(t) ? 0.5 : /double|twice|larger|bigger|heavier|faster|more/.test(t) ? 2 : (m = t.match(/(\d+(?:\.\d+)?)\s*(?:x|times)/)) ? Number(m[1]) : (m = t.match(/\b(one|two|three|half|twice|double)\b/)) ? N[m[1]] : 0.5;
    const parameter = /battery|energy budget|energy/.test(t) ? 'battery' : /mass|heavier|lighter/.test(t) ? 'mass' : /speed|faster|slower/.test(t) ? 'speed' : /soil|regolith/.test(t) ? 'soil' : /fidelity|wong|detailed/.test(t) ? 'fidelity' : /later|earlier|depart/.test(t) ? 'departure' : 'rover';
    return [{ tool: 'what_if', args: parameter === 'soil' ? { parameter, value: /loose|soft/.test(t) ? 'lunar-loose' : /firm|compact/.test(t) ? 'lunar-firm' : undefined } : parameter === 'departure' ? { parameter, factor: /later/.test(t) ? 2 : 0.5 } : { parameter, factor } }];
  }
  if (/\b(why|explain)\b.*\b(route|selected|chosen|prefer)/.test(t) && ctx.plan) return [{ tool: 'explain_route', args: {} }];
  if (/contradict|counter[- ]?evidence|disprove|red[- ]team|weak(ness|est)|what could be (wrong|improved)|improve/.test(t)) return [{ tool: 'red_team', args: {} }];
  if (/\b(evidence|provenance|why)\b.*\b(classif|detect|this|crater|anomal|unit|result)/.test(t)) return [{ tool: 'evidence', args: id ? { id } : {} }];
  if (/missing|what (data|measurements?)|data quality|quality check|gaps?\b/.test(t)) return [{ tool: 'data_quality', args: {} }];
  if (/hypothes/.test(t)) return [{ tool: 'hypothesis', args: id ? { id } : {} }];
  if (/\b(report|dossier)\b/.test(t)) return [{ tool: 'generate_dossier', args: {} }];
  if ((m = t.match(/compare\b.*\bwith\s+(?:an?\s+)?(?:earth\s+analog(?:ue)?\s*)?([a-z][a-z\s'-]+)$/)) && !/earth analog(ue)?$/.test(m[1])) return [{ tool: 'compare_analog', args: { earthSite: m[1].trim() } }];
  if (/compare.*earth analog/.test(t)) return [{ tool: 'compare_analog', args: { earthSite: 'boszhira' } }];
  if (/profile|cross[- ]section/.test(t)) return [{ tool: 'terrain_profile', args: {} }];
  const explain = /\b(explain|describe|what is|tell me about|inspect|what('|’)s)\b/.test(t);
  if (explain && ctx.selection && /\b(this|selected|here)\b/.test(t)) return ctx.selection.kind === 'object' ? [{ tool: 'describe_object', args: { id: ctx.selection.id } }] : [{ tool: 'describe_location', args: {} }];
  if (/boulder|rocks?\b/.test(t)) calls.push({ tool: 'find_features', args: { kind: 'boulders', region } });
  if (/interesting|deserve|investigat|geolog\w* (structure|feature|formation)|most notable|candidates?/.test(t)) calls.push({ tool: 'find_features', args: { kind: 'interesting', region } });
  else if (/hazard|danger|risk/.test(t)) calls.push({ tool: 'find_features', args: { kind: 'hazards', region } });
  if (/\bcraters?\b/.test(t) && !id && !calls.length) calls.push({ tool: 'find_features', args: { kind: 'craters', region } });
  if (/anomal|unusual|outlier/.test(t) && !id && !calls.length) calls.push({ tool: 'find_features', args: { kind: 'anomalies', region } });
  if (calls.length) return calls;
  if (/\b(explain|describe|what is|tell me about|inspect|what('|’)s)\b/.test(t)) {
    if (id) return [{ tool: 'describe_object', args: { id } }, { tool: 'hypothesis', args: { id } }];
    if (ctx.selection?.kind === 'object') return [{ tool: 'describe_object', args: { id: ctx.selection.id } }];
    if (ctx.selection) return [{ tool: 'describe_location', args: {} }];
    return [{ tool: 'find_features', args: { kind: 'units', region } }, { tool: 'find_features', args: { kind: 'interesting', region } }];
  }
  if (id) return [{ tool: 'describe_object', args: { id } }];
  return [];
}

export const CAPABILITIES = [
  'Fly to the site, a crater-NNNN / anomaly-NNN, the start or destination',
  'Show slopes above N degrees · show terrain units · highlight hazards / craters / anomalies',
  'Identify the most interesting geological structures and rover hazards',
  'Plan a rover survey: start, destination, N science stops, max slope, % reserve, objective',
  'Start the rover simulation · change the time to local noon',
  'What changes if the battery is halved / mass doubled / soil is loose?',
  'Why was this route selected? · What could be wrong? · Show the evidence behind this classification',
  'Compare this area with Boszhira (ATLAS-Π) · what measurements are missing? · generate a report',
];

let counter = 0;
export async function askLocal(text: string, ctx: ToolContext): Promise<CopilotAnswer> {
  const calls = planCalls(text, ctx), log: ToolCallLog[] = [];
  const answer: CopilotAnswer = { id: `a${++counter}`, request: text, provider: 'local', headline: '', sections: [], citations: [], tools: log };
  if (calls[0]?.tool === '__unsupported_target') {
    answer.headline = 'That target has no world package in this build.';
    answer.declined = `“${String(calls[0].args.target)}”: only the Mons Mouton (Moon) world is reconstructed. Jezero exists in EGIZ only as a 200 m MOLA–HRSC grid in Mission Lab, which cannot support this 5 m world; Earth windows are analysed in Transferability (ATLAS-Π).`;
    return answer;
  }
  if (!calls.length) {
    answer.headline = 'I could not map that request to an EGIZ capability.';
    answer.declined = 'The local copilot uses a fixed, documented command grammar and does not guess. Try one of the examples below, or enable the optional LLM provider in Intelligence → Models.';
    answer.sections.push({ title: 'Things I can do', ok: true, facts: CAPABILITIES.map(c => ({ label: '•', value: c, cls: 'derived' })), notes: [] });
    return answer;
  }
  for (const c of calls) {
    const r = await callTool(ctx, c.tool, c.args, log);
    answer.sections.push({ title: r.summary, ok: r.ok, facts: r.facts, notes: r.notes });
    answer.citations.push(...r.citations);
    if (!r.ok && c.tool === 'propose_mission') break;
  }
  const knowledge = searchKnowledge(text, 2, 2.2);
  for (const k of knowledge) if (!answer.citations.some(c => c.id === k.entry.id)) answer.citations.push({ kind: 'knowledge', id: k.entry.id, label: k.entry.citation, url: k.entry.url });
  answer.citations = answer.citations.filter((c, i, a) => c.id && a.findIndex(d => d.id === c.id) === i);
  answer.headline = answer.sections.map(s => s.title).join(' ');
  return answer;
}
