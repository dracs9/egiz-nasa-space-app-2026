// Unified model registry: Python-built perception models (from the world package) + browser-side
// inference components. Status reflects what actually runs in this build.
import type { ModelEntry } from '../core/types';

export const BROWSER_MODELS: ModelEntry[] = [
  {
    id: 'egiz.copilot.local-intent', name: 'Local intent parser + tool planner', task: 'natural-language command understanding',
    architecture: 'Deterministic pattern grammar → typed, allowlisted tool calls → templated grounded answers', trainingDomain: 'None (rule-based)',
    inputs: ['English text', 'studio context'], resolution: 'n/a', weights: 'none', version: '1.0.0', license: 'MIT (EGIZ)', hardware: 'CPU (browser)', memory: '< 10 MB',
    inference: 'Browser, synchronous', status: ['available', 'inference_ready'], runtime: 'browser',
    evaluation: 'Unit tests on the documented command set. Not a language model: unrecognised phrasing is reported, not guessed.',
    limitations: ['Understands a fixed command vocabulary; paraphrases outside it are declined explicitly.', 'Does not generate free-form scientific prose.'],
  },
  {
    id: 'egiz.retrieval.bm25', name: 'Evidence retrieval (BM25)', task: 'retrieval-augmented citation', architecture: 'Okapi BM25 over a curated corpus of real publications and EGIZ records',
    trainingDomain: 'n/a', inputs: ['query text'], resolution: 'n/a', weights: 'none', version: '1.0.0', license: 'MIT (EGIZ)', hardware: 'CPU (browser)', memory: '< 1 MB',
    inference: 'Browser', status: ['available', 'inference_ready'], runtime: 'browser',
    evaluation: 'Corpus is small and curated; recall outside it is zero by design.', limitations: ['Summaries are EGIZ paraphrases; consult the cited source.'],
  },
  {
    id: 'egiz.surrogate.energy-ridge', name: 'Route energy surrogate', task: 'simulation surrogate (traverse energy)',
    architecture: 'Ridge regression on route descriptors (length, ascent, descent, grade histogram, stops), trained in-browser on deterministic simulator runs',
    trainingDomain: 'EGIZ traverse simulator outputs on this world', inputs: ['route profile descriptors'], resolution: 'per route', weights: 'computed at runtime (not persisted)',
    version: '1.0.0', license: 'MIT (EGIZ)', hardware: 'CPU (browser)', memory: '< 1 MB', inference: 'Browser', status: ['training_available', 'experimental'], runtime: 'browser',
    evaluation: 'Held-out error is reported each time it is trained; out-of-range inputs are rejected and the simulator remains the authority.',
    limitations: ['Never replaces the simulator; used only to rank many candidate scenarios quickly.', 'Valid only inside the training descriptor ranges.'],
  },
  {
    id: 'remote.llm.anthropic', name: 'Optional remote LLM (Anthropic Claude)', task: 'conversational tool orchestration',
    architecture: 'Hosted large language model using the same typed tool schemas; all numbers come from tools', trainingDomain: 'General (provider-trained)',
    inputs: ['text', 'tool results'], resolution: 'n/a', weights: 'remote (provider)', version: 'user-selected', license: 'Provider terms', hardware: 'Remote',
    memory: 'n/a', inference: 'HTTPS from the browser with a user-supplied key (kept in session memory only)', status: ['unavailable'], runtime: 'remote',
    evaluation: 'Not evaluated by EGIZ. Optional; EGIZ is fully functional without it.',
    limitations: ['Requires the user’s own API key and network access.', 'May phrase answers differently; tool outputs remain the source of numbers.'],
  },
];

export function mergeRegistry(python: ModelEntry[], remoteAvailable: boolean): ModelEntry[] {
  return [...python, ...BROWSER_MODELS.map(m => m.id === 'remote.llm.anthropic' && remoteAvailable ? { ...m, status: ['available', 'inference_ready'] as ModelEntry['status'] } : m)];
}

export const STATUS_LABEL: Record<string, string> = {
  available: 'Available', installed: 'Installed', download_required: 'Download required', inference_ready: 'Inference ready', training_available: 'Training available',
  experimental: 'Experimental', unavailable: 'Unavailable', incompatible: 'Incompatible domain',
};
