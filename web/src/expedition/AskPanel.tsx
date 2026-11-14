// EGIZ · ask about the mission. The deterministic research assistant of the Planetary Studio: a question is
// planned onto EGIZ's engine tools, every number in the answer comes from those tools, and the independent critic
// reviews it (it can reject). No language model is called and nothing is generated. Answers are shared with the
// Planetary Studio's assistant panel.
import { useMemo, useState } from 'react';
import { ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { t } from '../i18n';
import { ask, describeContext, type IntelContext } from '../planet/intel/engine';
import { usePlanet } from '../planet/workspace/store';

const VERDICT = { supported: ['Supported', ShieldCheck], conditional: ['Conditional', ShieldQuestion], rejected: ['Rejected by review', ShieldAlert], informational: ['Informational', ShieldQuestion] } as const;
const QUESTIONS = ['Why is this candidate ranked here?', 'Which assumptions influence this ranking the most?', 'What measurements would reduce uncertainty?', 'Where are the models least reliable?'];

export function useIntelContext(selected?: string | null): IntelContext {
  const s = usePlanet(), target = s.inv.target ? s.target() : null;
  return useMemo(() => ({
    site: s.site, layers: s.layers, selection: s.selection, timeS: s.timeS, config: s.config, plan: s.plan, run: s.run, sensitivity: s.sensitivity,
    discovery: s.bundle && s.shard && target && s.shard.target === target.id ? { bundle: s.bundle, target, shard: s.shard, weights: s.weights(), selected: selected ?? s.inv.candidates.at(-1) ?? s.inv.analysis?.top10[0] ?? null, compare: s.inv.candidates.slice(-4), validation: s.validation } : null,
    atlas: s.atlas, compare: s.compare, space: s.space,
  }), [s.site, s.layers, s.selection, s.timeS, s.config, s.plan, s.run, s.sensitivity, s.bundle, s.shard, s.inv.candidates, s.inv.weights, s.inv.profile, s.inv.analysis, s.validation, s.atlas, s.compare, s.space, target, selected]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function AskPanel({ selected, title = 'Ask about these results' }: { selected?: string | null; title?: string }) {
  const s = usePlanet(), ctx = useIntelContext(selected), [q, setQ] = useState(''), [mine, setMine] = useState<string[]>([]);
  const submit = (text: string) => { const v = text.trim(); if (!v) return; const a = ask(v, ctx); usePlanet.getState().set({ answers: [...usePlanet.getState().answers, a].slice(-30) }); setMine(m => [...m, a.id]); setQ(''); };
  const answers = s.answers.filter(a => mine.includes(a.id)).reverse();
  return <section className="xp-ask" aria-label={t(title)}>
    {title && <h2 className="xp-h3">{t(title)}</h2>}
    <p className="xp-dim xp-small">{t('Deterministic assistant: it calls EGIZ’s engines and an independent critic reviews every answer. No language model, no generated numbers.')} <span className="xp-ctx">{describeContext(ctx)}</span></p>
    <form onSubmit={e => { e.preventDefault(); submit(q); }}><input value={q} onChange={e => setQ(e.target.value)} placeholder={t('Ask a question…')} aria-label={t('Research question')} autoComplete="off" /><button className="eg-button" disabled={!q.trim() || !ctx.discovery}>{t('Ask')}</button></form>
    <div className="xp-suggest">{QUESTIONS.map(x => <button key={x} disabled={!ctx.discovery} onClick={() => submit(x)}>{t(x)}</button>)}</div>
    <div aria-live="polite">{answers.map(a => { const [label, Icon] = VERDICT[a.verdict]; return <article key={a.id} className={`xp-answer v-${a.verdict}`}>
      <h3>{a.question}</h3>
      <p className="xp-verdict"><Icon size={14} />{t(label)} <span className="xp-dim">· {a.plan.map(p => p.tool).join(' → ')}</span></p>
      {a.results.map((r, i) => <div key={i} className={r.ok ? '' : 'failed'}><h4>{r.title}</h4><p>{r.summary}</p>
        {r.facts.length > 0 && <dl className="xp-facts">{r.facts.map((f, k) => <div key={k}><dt>{f.label}</dt><dd>{f.value}<em className={`xp-ev ev-${f.evidence.replace(/[^a-z]/g, '')}`}>{f.evidence}</em></dd></div>)}</dl>}
        {r.notes.length > 0 && <ul className="xp-notes">{r.notes.map(n => <li key={n}>{n}</li>)}</ul>}</div>)}
      {a.findings.length > 0 && <ul className="xp-findings-list">{a.findings.map(f => <li key={f.code} className={`f-${f.severity}`}><b>{f.title}</b> — {f.detail}</li>)}</ul>}
      <button className="xp-link" onClick={() => usePlanet.getState().keepAnswer(a)} disabled={s.inv.answers.some(x => x.id === a.id && x.question === a.question)}>{s.inv.answers.some(x => x.id === a.id && x.question === a.question) ? t('Kept in the mission record') : t('Keep in the mission record')}</button>
    </article>; })}</div>
  </section>;
}
