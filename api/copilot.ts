// Server-side LLM proxy for the EGIZ Discover research assistant (Vercel serverless function).
// The Anthropic API key is read from ANTHROPIC_API_KEY on the server and never sent to the browser.
// The model, system prompt and tool list are fixed HERE; the browser only sends the conversation
// (its question and the outputs of the allowlisted tools it executed on the measured bundle).
// GET  -> { available, model }            (lets the UI show whether the model is configured)
// POST -> { content, stop_reason, model } (one model turn; the browser runs tools and loops)
import Anthropic from '@anthropic-ai/sdk';
import { TOOLS } from '../web/src/discover/copilot';

declare const process: { env: Record<string, string | undefined> };
export const config = { maxDuration: 60 };
const MODEL = 'claude-opus-5-5';
const MAX_MESSAGES = 30;
const MAX_BODY_CHARS = 300_000;

const SYSTEM = `You are the research assistant inside EGIZ Discover, an Earth-wide search for terrestrial analogs of lunar and Martian sites.
Rules:
- Use the provided tools for every quantitative statement (scores, similarities, percentiles, intervals, gaps, rover results). Never estimate or invent numbers, sites, measurements or citations.
- Distinguish observations, derived measurements, modelled values (climatology), proxies (map lithology, land-cover classes), simulations (rover model) and assumptions, using the evidence labels the tools return.
- Dimensions marked not assessed have no dataset; say so instead of guessing. Similarity is not proof that a site is a good analog: name the gaps.
- Kazakhstan sites are hypotheses, not predetermined winners.
Answer in the user's language, in a few sentences, then let the tool results speak.`;

const tools = TOOLS.map(t => ({ name: t.name, description: t.description, input_schema: t.schema as { type: 'object'; [k: string]: unknown } }));

interface Req { method?: string; body?: unknown }
interface Res { status(code: number): Res; json(body: unknown): void; setHeader(name: string, value: string): void }

function validMessages(body: unknown): Anthropic.Beta.BetaMessageParam[] | null {
  if (!body || typeof body !== 'object') return null;
  const messages = (body as { messages?: unknown }).messages;
  if (!Array.isArray(messages) || !messages.length || messages.length > MAX_MESSAGES) return null;
  if (JSON.stringify(messages).length > MAX_BODY_CHARS) return null;
  if (!messages.every(m => m && typeof m === 'object' && ((m as { role?: string }).role === 'user' || (m as { role?: string }).role === 'assistant'))) return null;
  if ((messages[0] as { role: string }).role !== 'user') return null;
  return messages as Anthropic.Beta.BetaMessageParam[];
}

export default async function handler(req: Req, res: Res) {
  res.setHeader('cache-control', 'no-store');
  const key = process.env.ANTHROPIC_API_KEY;
  if (req.method === 'GET') return res.status(200).json({ available: !!key, model: MODEL });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  if (!key) return res.status(503).json({ error: 'language model not configured on this deployment' });
  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body as string); } catch { return null; } })() : req.body;
  const messages = validMessages(body);
  if (!messages) return res.status(400).json({ error: 'invalid conversation' });
  const client = new Anthropic({ apiKey: key, maxRetries: 2 });
  try {
    const response = await client.beta.messages.create({
      model: MODEL, max_tokens: 16000, system: SYSTEM, tools, messages,
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    });
    if (response.stop_reason === 'refusal') return res.status(200).json({ content: [], stop_reason: 'refusal', model: response.model, declined: `The model declined (${response.stop_details?.category ?? 'unspecified'}).` });
    return res.status(200).json({ content: response.content, stop_reason: response.stop_reason, model: response.model });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return res.status(429).json({ error: 'rate limited, retry later' });
    if (error instanceof Anthropic.APIConnectionError || error instanceof Anthropic.APIConnectionTimeoutError) return res.status(502).json({ error: 'model API unreachable' });
    if (error instanceof Anthropic.APIError) return res.status(502).json({ error: `model API error ${error.status ?? "unknown"}` });
    return res.status(500).json({ error: 'proxy failure' });
  }
}
