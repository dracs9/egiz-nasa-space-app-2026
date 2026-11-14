// EGIZ ASTRAL · research copilot. Natural-language requests are parsed into typed calls to an allow-list of tools.
// Every number in an answer comes from a tool result; the copilot composes text, it does not estimate.
import type { XY } from "../world/field.ts";

export type SectionKind = "measured" | "derived" | "model" | "assumption" | "limit" | "source" | "action";
export const SECTION_LABEL: Record<SectionKind, string> = { measured: "Measured", derived: "Computed", model: "Model interpretation", assumption: "Assumption", limit: "Limitation", source: "Source", action: "Done" };
export interface Section { kind: SectionKind; text: string }
export interface ToolResult { ok: boolean; title: string; sections: Section[]; evidence?: string[] }
export type Param =
  | { type: "number"; min: number; max: number; optional?: boolean }
  | { type: "enum"; values: readonly string[]; optional?: boolean }
  | { type: "place"; optional?: boolean }
  | { type: "boolean"; optional?: boolean };
export interface ToolSpec { name: string; description: string; params: Record<string, Param>; confirm?: string }
export interface ToolCall { tool: string; args: Record<string, unknown> }
export interface ToolLog { at: string; call: ToolCall; ok: boolean; title: string }

export const TOOLS: ToolSpec[] = [
  { name: "fly_to", description: "Move the camera to a named place, object or coordinate.", params: { place: { type: "place" } } },
  { name: "show_layer", description: "Display an analysis layer on the terrain.", params: { layer: { type: "enum", values: ["none", "elevation", "slope", "roughness", "classes", "units", "anomaly", "similar", "traversability", "shadow-hours"] }, slopeAbove: { type: "number", min: 0, max: 60, optional: true } } },
  { name: "set_time", description: "Set scene time within the SPICE record.", params: { moment: { type: "enum", values: ["noon", "sunrise", "sunset"], optional: true }, localHour: { type: "number", min: 0, max: 24, optional: true } } },
  { name: "set_camera", description: "Change the camera mode.", params: { mode: { type: "enum", values: ["site", "top", "follow", "first", "free"] } } },
  { name: "explain_area", description: "Describe terrain around a place from measured and derived layers.", params: { place: { type: "place", optional: true }, radius: { type: "number", min: 10, max: 600, optional: true } } },
  { name: "find_hazards", description: "Detect rover hazards (slope, roughness, rocks) around a place.", params: { place: { type: "place", optional: true }, radius: { type: "number", min: 20, max: 400, optional: true } } },
  { name: "find_science_targets", description: "Rank candidate science targets.", params: { count: { type: "number", min: 1, max: 12, optional: true } } },
  { name: "hypotheses", description: "Generate falsifiable hypotheses for a place.", params: { place: { type: "place", optional: true } } },
  { name: "plan_mission", description: "Build, validate, route and simulate a rover mission.", params: { from: { type: "place", optional: true }, to: { type: "place", optional: true }, maxSlopeDeg: { type: "number", min: 1, max: 45, optional: true }, reservePercent: { type: "number", min: 0, max: 90, optional: true }, objective: { type: "enum", values: ["safest", "energy", "shortest"], optional: true }, scienceStops: { type: "number", min: 0, max: 6, optional: true } } },
  { name: "set_rover", description: "Select a rover profile or change a parameter.", params: { rover: { type: "enum", values: ["m2020-class", "egiz-scout"], optional: true }, batteryScale: { type: "number", min: 0.1, max: 3, optional: true }, surface: { type: "enum", values: ["dry-sand", "mars-drift", "bedrock", "lunar-regolith", "classified"], optional: true } } },
  { name: "run_simulation", description: "Run the mission simulation for the current specification.", params: { fidelity: { type: "enum", values: ["fast", "detailed"], optional: true } } },
  { name: "what_if", description: "Re-run the mission with one change and compare.", params: { batteryScale: { type: "number", min: 0.1, max: 3, optional: true }, surface: { type: "enum", values: ["dry-sand", "mars-drift", "bedrock", "lunar-regolith", "classified"], optional: true }, rover: { type: "enum", values: ["m2020-class", "egiz-scout"], optional: true } } },
  { name: "stress_test", description: "Look for evidence against the current mission assessment.", params: {} },
  { name: "measure", description: "Distance, elevation change and line of sight between two places.", params: { from: { type: "place" }, to: { type: "place" } } },
  { name: "missing_data", description: "List measurements and datasets the current assessment lacks.", params: {} },
  { name: "evidence", description: "Show sources and method for the current selection or result.", params: { topic: { type: "enum", values: ["selection", "mission", "terrain", "method"], optional: true } } },
  { name: "open_analogs", description: "Open the existing Earth-analog comparison for this target.", params: {} },
  { name: "generate_dossier", description: "Export the reproducible mission dossier.", params: {} },
  { name: "reset_mission", description: "Clear waypoints and the simulation result.", params: {}, confirm: "This clears the planned mission, its waypoints and the simulation record." },
];
const SPEC = new Map(TOOLS.map(t => [t.name, t]));
export type PlaceRef = { name: string } | XY;
export const isPoint = (v: unknown): v is XY => !!v && typeof v === "object" && Number.isFinite((v as XY).x) && Number.isFinite((v as XY).y);

/** Reject any call that is not on the allow-list or whose arguments break the declared schema. */
export function validateCall(call: ToolCall): string[] {
  const spec = SPEC.get(call.tool);
  if (!spec) return [`Unknown tool: ${call.tool}`];
  const errors: string[] = [];
  for (const key of Object.keys(call.args)) if (!(key in spec.params)) errors.push(`Unexpected argument: ${key}`);
  for (const [key, p] of Object.entries(spec.params)) {
    const v = call.args[key];
    if (v === undefined || v === null) { if (!p.optional) errors.push(`Missing argument: ${key}`); continue; }
    if (p.type === "number" && !(typeof v === "number" && Number.isFinite(v) && v >= p.min && v <= p.max)) errors.push(`${key} must be a number between ${p.min} and ${p.max}`);
    if (p.type === "enum" && !p.values.includes(v as string)) errors.push(`${key} must be one of: ${p.values.join(", ")}`);
    if (p.type === "boolean" && typeof v !== "boolean") errors.push(`${key} must be true or false`);
    if (p.type === "place" && !(isPoint(v) || (typeof (v as { name?: unknown }).name === "string" && (v as { name: string }).name.length <= 80))) errors.push(`${key} must be a place name or coordinates`);
  }
  return errors;
}

const NUMBER_WORDS: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, a: 1, an: 1, no: 0 };
const num = (s: string | undefined) => (s === undefined ? undefined : s.toLowerCase() in NUMBER_WORDS ? NUMBER_WORDS[s.toLowerCase()] : Number(s));
function place(text: string | undefined): PlaceRef | undefined {
  if (!text) return undefined;
  const xy = text.match(/(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)/);
  if (xy) return { x: Number(xy[1]), y: Number(xy[2]) };
  const name = text.replace(/\b(the|this|that|at|to|from|near|around|area|point|of|in)\b/gi, " ").replace(/[.?!]+$/, "").replace(/\s+/g, " ").trim();
  return name ? { name } : { name: "selection" };
}
const objective = (raw: string) => { const t = raw.replace(/\d+\s*%\s*(energy|battery|power)?\s*reserve|(energy|battery|power)\s+reserve|energy budget/g, " "); return /(safe|risk|hazard)/.test(t) ? "safest" : /(energy|power|battery|efficient)/.test(t) ? "energy" : /(short|fast|quick|direct)/.test(t) ? "shortest" : undefined; };
const surface = (t: string) => (/(drift|weak|soft)/.test(t) ? "mars-drift" : /(bedrock|rock surface|hard)/.test(t) ? "bedrock" : /(classified|mapped|terrain[- ]unit)/.test(t) ? "classified" : /(lunar|regolith)/.test(t) ? "lunar-regolith" : /sand/.test(t) ? "dry-sand" : undefined);
const drop = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && !(typeof v === "number" && Number.isNaN(v))));

/** Map a request to tool calls. Returns an empty list when nothing matches; the caller then says so. */
export function parseIntent(input: string): ToolCall[] {
  const t = input.trim(), s = t.toLowerCase(), call = (tool: string, args: Record<string, unknown> = {}): ToolCall[] => [{ tool, args: drop(args) }];
  let m: RegExpMatchArray | null;
  if (!s) return [];
  if (/(reset|clear|start over).*(mission|route|plan)/.test(s)) return call("reset_mission");
  if (/(dossier|report|export)/.test(s) && /(generate|create|make|export|produce|download|write)/.test(s)) return call("generate_dossier");
  if (/(contradict|against|wrong|stress|red.?team|could fail|what could go wrong|weak(est)? point)/.test(s)) return call("stress_test");
  if (/(missing|lack|gap|don't know|not known|unknown|need(ed)? (data|measurement)|what measurements)/.test(s)) return call("missing_data");
  if (/what (?:changes|happens) if|what if/.test(s)) {
    const percent = s.match(/(\d+(?:\.\d+)?)\s*%/), less = /(smaller|less|lower|reduc)/.test(s), more = /(larger|bigger|more|higher|increas)/.test(s);
    const scale = /(half|halve)/.test(s) ? 0.5 : /(double|twice)/.test(s) ? 2 : percent && less ? 1 - Number(percent[1]) / 100 : percent && more ? 1 + Number(percent[1]) / 100 : less ? 0.6 : more ? 1.5 : undefined;
    return call("what_if", { batteryScale: /(energy|battery|power|budget)/.test(s) && scale !== undefined ? Math.round(scale * 100) / 100 : undefined, surface: surface(s), rover: /scout/.test(s) ? "egiz-scout" : /(2020|perseverance)/.test(s) ? "m2020-class" : undefined });
  }
  if (/(plan|route|traverse|drive|survey|mission)/.test(s) && /(plan|create|build|find|make|design|generate|route to|drive to|survey)/.test(s)) {
    const XY = String.raw`\(?\s*-?\d+(?:\.\d+)?\s*[,;]\s*-?\d+(?:\.\d+)?\s*\)?`;
    const from = t.match(new RegExp(String.raw`(?:starting (?:at|from)|from|start at)\s+(${XY})`, "i"))?.[1] ?? t.match(/(?:starting (?:at|from)|from|start at)\s+(.+?)(?=,|\s+(?:to|and|avoiding|with|prioriti|preserv|keeping|that|minimi)\b|$)/i)?.[1];
    const to = t.match(new RegExp(String.raw`(?:\bto\b|ending at|destination)\s+(${XY})`, "i"))?.[1] ?? t.match(/(?:\bto\b|ending at|destination)\s+(?!minimi|avoid|includ|preserv)(.+?)(?=,|\s+(?:and|avoiding|with|prioriti|preserv|keeping|that|minimi|from|starting)\b|$)/i)?.[1];
    return call("plan_mission", { from: place(from), to: place(to),
      maxSlopeDeg: num(s.match(/slopes?\s+(?:above|over|greater than|steeper than|>)\s*(\d+(?:\.\d+)?)/)?.[1] ?? s.match(/(\d+(?:\.\d+)?)\s*(?:°|deg(?:rees?)?)\s*(?:slope|limit|max)/)?.[1]),
      reservePercent: num(s.match(/(\d+(?:\.\d+)?)\s*%\s*(?:energy|battery|power)?\s*reserve/)?.[1] ?? s.match(/reserve\s*(?:of)?\s*(\d+(?:\.\d+)?)\s*%/)?.[1]),
      objective: objective(s), scienceStops: num(s.match(/(\d+|one|two|three|four|five|six)\s+(?:science|geolog\w*|sampling|observation)?\s*(?:stops?|waypoints?|targets?)/)?.[1]) ?? (/geological diversity|science/.test(s) ? 3 : undefined) });
  }
  if (/(start|run|launch|begin|simulate).*(simulation|sim|rover|mission|drive)/.test(s) || /^simulate/.test(s)) return call("run_simulation", { fidelity: /detail/.test(s) ? "detailed" : /fast|quick/.test(s) ? "fast" : undefined });
  if ((m = s.match(/(?:fly|go|zoom|move|take me|jump|navigate) to (.+)/))) return call("fly_to", { place: place(t.slice(t.toLowerCase().indexOf(m[1]))) });
  if (/(solar time|time of day|sun|local time|\bnoon\b|sunrise|sunset)/.test(s) && /(set|change|make|move|at|to)/.test(s)) {
    const moment = /noon|midday/.test(s) ? "noon" : /sunrise|dawn/.test(s) ? "sunrise" : /sunset|dusk/.test(s) ? "sunset" : undefined;
    return call("set_time", { moment, localHour: moment ? undefined : num(s.match(/(\d{1,2})(?::00)?\s*(?:h|o'clock|local|lst|ltst)?/)?.[1]) });
  }
  if ((m = s.match(/slopes?\s+(?:above|over|greater than|steeper than|>)\s*(\d+(?:\.\d+)?)/))) return call("show_layer", { layer: "slope", slopeAbove: Number(m[1]) });
  if (/(camera|view)/.test(s) && (m = s.match(/(first.person|onboard|mast|follow|chase|third.person|top.down|overhead|plan view|overview|site|free)/))) return call("set_camera", { mode: /first|onboard|mast/.test(m[1]) ? "first" : /follow|chase|third/.test(m[1]) ? "follow" : /top|overhead|plan/.test(m[1]) ? "top" : /free/.test(m[1]) ? "free" : "site" });
  if (/(hazard|danger|obstacle|boulder|rock field|rocks)/.test(s)) return call("find_hazards", { place: place(t.match(/(?:around|near|at)\s+(.+)/i)?.[1]), radius: num(s.match(/(\d+)\s*m(?:et(?:er|re)s?)?\b/)?.[1]) });
  if (/(hypothes)/.test(s)) return call("hypotheses", { place: place(t.match(/(?:for|at|about)\s+(.+)/i)?.[1]) });
  if (/(deserve|worth|interesting|science target|scientific interest|investigat|where should)/.test(s)) return call("find_science_targets", { count: num(s.match(/(\d+|one|two|three|four|five|six)\s+(?:targets?|places?|sites?|formations?|structures?)/)?.[1]) });
  if ((m = t.match(/(?:distance|measure|how far|line of sight|profile).*?(?:from|between)\s+(.+?)\s+(?:to|and)\s+(.+)/i))) return call("measure", { from: place(m[1]), to: place(m[2]) });
  if (/(compare|analog|analogue)/.test(s) && /(earth|analog|analogue|bozjyra|boszhira|utah|iceland|atacama)/.test(s)) return call("open_analogs");
  if (/(evidence|source|provenance|\bwhy\b|behind|how (is|was|do you)|method)/.test(s)) return call("evidence", { topic: /(route|mission|select|chosen|rover|slip|energy|battery)/.test(s) ? "mission" : /(how|method|comput|calculat)/.test(s) ? "method" : /(class|terrain|unit)/.test(s) ? "terrain" : "selection" });
  if ((m = s.match(/(?:show|display|highlight|overlay|turn on|hide|turn off)\s+(.+)/))) {
    const k = m[1], layer = /hide|turn off/.test(s) || /(image|ortho|nothing|none)/.test(k) ? "none" : /travers|mobility|drivab/.test(k) ? "traversability" : /shadow|illuminat|sunlight|solar exposure/.test(k) ? "shadow-hours" : /slope/.test(k) ? "slope" : /rough/.test(k) ? "roughness" : /elev|height|topograph/.test(k) ? "elevation" : /unit|cluster/.test(k) ? "units" : /anomal|outlier|unusual/.test(k) ? "anomaly" : /similar/.test(k) ? "similar" : /class|terrain|geolog|bedrock|dune|surface/.test(k) ? "classes" : undefined;
    if (layer) return call("show_layer", { layer });
  }
  if (/(rover|vehicle)/.test(s) && /(use|select|switch|choose|change)/.test(s)) return call("set_rover", { rover: /scout/.test(s) ? "egiz-scout" : /(2020|perseverance|reference)/.test(s) ? "m2020-class" : undefined, surface: surface(s) });
  if (/(explain|describe|what is|what's|what am i|tell me about|geolog|structure|interpret|visible)/.test(s)) return call("explain_area", { place: place(t.match(/(?:around|near|at|of)\s+(.+)/i)?.[1]), radius: num(s.match(/(\d+)\s*m(?:et(?:er|re)s?)?\b/)?.[1]) });
  return [];
}

export interface CopilotReply { calls: ToolCall[]; results: ToolResult[]; needsConfirmation?: { call: ToolCall; message: string }; unknown?: boolean }
export type ToolRunner = (call: ToolCall) => Promise<ToolResult> | ToolResult;
/** Provider-neutral seam: a remote model could implement this by emitting the same ToolCall objects. */
export interface CopilotProvider { id: string; plan(input: string): Promise<ToolCall[]> | ToolCall[] }
export const LOCAL_PROVIDER: CopilotProvider = { id: "egiz-copilot-intent-v1", plan: parseIntent };

/** Parse → validate → (confirm) → execute → log. Tools never run with unvalidated arguments. */
export async function ask(input: string, run: ToolRunner, log: ToolLog[], options: { confirmed?: boolean; provider?: CopilotProvider } = {}): Promise<CopilotReply> {
  const calls = await (options.provider ?? LOCAL_PROVIDER).plan(input);
  if (!calls.length) return { calls, results: [], unknown: true };
  const results: ToolResult[] = [];
  for (const call of calls) {
    const errors = validateCall(call), spec = SPEC.get(call.tool);
    if (errors.length) { results.push({ ok: false, title: "Request rejected", sections: errors.map(text => ({ kind: "limit" as const, text })) }); log.push({ at: new Date().toISOString(), call, ok: false, title: "rejected: invalid arguments" }); continue; }
    if (spec?.confirm && !options.confirmed) return { calls, results, needsConfirmation: { call, message: spec.confirm } };
    let result: ToolResult;
    try { result = await run(call); } catch (error) { result = { ok: false, title: "Tool failed", sections: [{ kind: "limit", text: error instanceof Error ? error.message : String(error) }] }; }
    results.push(result); log.push({ at: new Date().toISOString(), call, ok: result.ok, title: result.title });
  }
  return { calls, results };
}
export const EXAMPLES = [
  "Explain the geological structure of this area",
  "Find potential rover hazards around this point",
  "Which formations deserve further investigation?",
  "Show slopes above 15 degrees",
  "Plan a rover survey from the landing site to the selection, avoiding slopes above 18 degrees, with three science stops and a 25% energy reserve",
  "What changes if the rover has a smaller energy budget?",
  "Find evidence contradicting this assessment",
  "What measurements are missing?",
  "Change the solar time to local noon",
  "Generate a report",
];
