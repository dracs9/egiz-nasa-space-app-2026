// EGIZ Planetary Studio · context-aware research assistant. It knows the active target, candidate, 3D site,
// selected point, mission and comparison, so questions need not restate them. Answers are assembled from engine
// results; the critic's review is shown with every answer and can reject it.
import { useMemo, useState } from 'react';
import { ShieldAlert, ShieldCheck, ShieldQuestion, X } from 'lucide-react';
import { ask, describeContext, SUGGESTIONS, type IntelContext } from '../intel/engine';
import { usePlanet } from '../workspace/store';
import { useCtl } from './ctl';

const VERDICT = { supported: ['Supported', ShieldCheck], conditional: ['Conditional', ShieldQuestion], rejected: ['Rejected by review', ShieldAlert], informational: ['Informational', ShieldQuestion] } as const;
export function IntelPanel() {
  const s = usePlanet(), ctl = useCtl(), [q, setQ] = useState(''), target = s.target();
  const ctx: IntelContext = useMemo(() => ({
    site: s.site, layers: s.layers, selection: s.selection, timeS: s.timeS, config: s.config, plan: s.plan, run: s.run, sensitivity: s.sensitivity,
    discovery: s.bundle && s.shard && target && s.shard.target === target.id ? { bundle: s.bundle, target, shard: s.shard, weights: s.weights(), selected: s.inv.candidates.at(-1) ?? s.site?.discoveryWindow ?? null, compare: s.inv.candidates.slice(-4), validation: s.validation } : null,
    atlas: s.atlas, compare: s.compare, space: s.space,
  }), [s.site, s.layers, s.selection, s.timeS, s.config, s.plan, s.run, s.sensitivity, s.bundle, s.shard, s.inv.candidates, s.inv.weights, s.inv.profile, s.validation, s.atlas, s.compare, s.space, target]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = (text: string) => { const t = text.trim(); if (!t) return; usePlanet.getState().set({ answers: [...usePlanet.getState().answers, ask(t, ctx)].slice(-30) }); setQ(''); };
  return <aside className="pl-intel" aria-label="Research assistant">
    <header><b>Assistant</b><span className="pl-dim">deterministic · calls EGIZ engines · no generated numbers</span><button aria-label="Close assistant" onClick={() => s.set({ intelOpen: false })}><X size={15} /></button></header>
    <p className="pl-intel-ctx"><span>Context</span>{describeContext(ctx)}</p>
    <form onSubmit={e => { e.preventDefault(); submit(q); }}><input id="pl-ask" value={q} onChange={e => setQ(e.target.value)} placeholder="Ask…" aria-label="Research question" autoComplete="off" /><button className="pl-primary" disabled={!q.trim()}>Ask</button></form>
    <div className="pl-suggest">{SUGGESTIONS.slice(0, 4).map(x => <button key={x} onClick={() => submit(x)}>{x}</button>)}</div>
    <div className="pl-answers" aria-live="polite">
      
      {[...s.answers].reverse().map(a => { const [label, Icon] = VERDICT[a.verdict]; return <article key={a.id} className={`pl-answer v-${a.verdict}`}>
        <h3>{a.question}</h3>
        <p className="pl-verdict"><Icon size={14} />{label}<span className="pl-dim"> · {a.context}</span></p>
        <p className="pl-plan">{a.plan.map(p => <code key={p.tool}>{p.tool}</code>)}</p>
        {a.results.map((r, i) => <section key={i} className={r.ok ? '' : 'failed'}>
          <h4>{r.title}</h4><p>{r.summary}</p>
          {r.facts.length > 0 && <dl className="pl-facts">{r.facts.map((f, k) => <div key={k} className="pl-fact"><dt>{f.label}</dt><dd>{f.value}<em className={`pl-ev ev-${f.evidence.replace(/[^a-z]/g, '')}`}>{f.evidence}</em></dd></div>)}</dl>}
          {(r.notes.length > 0 || r.sources.length > 0) && <details><summary>Assumptions, limits and sources</summary><ul className="pl-limits">{r.notes.map(x => <li key={x}>{x}</li>)}{r.sources.map(x => <li key={x} className="pl-dim">{x}</li>)}</ul></details>}
          {r.actions.length > 0 && <div className="pl-row">{r.actions.map(x => <button key={x.label} onClick={() => ctl.execute(x)}>{x.label}</button>)}</div>}
        </section>)}
        {a.findings.length > 0 && <section className="pl-critic"><h4>Independent review</h4><ul>{a.findings.map(f => <li key={f.code} className={`f-${f.severity}`}><b>{f.title}</b>{f.detail}</li>)}</ul></section>}
        <button className="pl-link" disabled={s.inv.answers.some(x => x.id === a.id && x.question === a.question)} onClick={() => s.keepAnswer(a)}>{s.inv.answers.some(x => x.id === a.id && x.question === a.question) ? 'Kept' : 'Keep in report'}</button>
      </article>; })}
    </div>
  </aside>;
}
