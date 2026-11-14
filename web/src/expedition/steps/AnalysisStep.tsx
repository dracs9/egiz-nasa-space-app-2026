// EGIZ · step 3, Analysis. The visitor states the mission question (a priority profile) and runs EGIZ's engines
// on the site: the discovery index, ranking stress test, the candidate-space machine-learning model, the gap
// ledger, published-analog validation, ATLAS-Π and the independent critic. Steps execute in this browser one
// after another; each shows its method, its data, its own measured run time and its outputs. Findings are written
// from those outputs by fixed rules. A stored run can be re-executed to check it reproduces.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, ChevronRight, CircleAlert, CircleDashed, LoaderCircle, RotateCcw, ShieldCheck, TriangleAlert } from 'lucide-react';
import { t } from '../../i18n';
import { usePlanet } from '../../planet/workspace/store';
import { analysisCurrent, insights, runStep, STEPS, toRecord, type AnalysisInput, type Insight, type RunState, type StepId, type StepResult } from '../../planet/journey/analysis';
import { AskPanel } from '../AskPanel';
import { More } from '../More';
import { trTitle } from '../trEngine';
import { StepFooter, StepHead } from '../ExpeditionPage';
import { fmtMs, short, utcShort } from '../format';

export const PROFILE_MEANING: Record<string, string> = {
  general: 'A balanced resemblance across terrain, surface, climate, light and geology.',
  rover_mobility: 'Driving: slopes, roughness and regional relief dominate.',
  eva_geology: 'Astronauts on foot doing field geology and sampling: exposed rock, geology, mineralogy.',
  power_illumination: 'Solar power and low-Sun operations: light, regional relief, temperature, dust.',
  astrobiology: 'Habitability research: dryness, mineralogy, geology, ice.',
};
const nowUtc = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function AnalysisStep() {
  const s = usePlanet(), b = s.bundle, x = s.inv.target ? s.target() : null, weights = s.weights(), shardReady = !!(s.shard && x && s.shard.target === x.id);
  const [results, setResults] = useState<StepResult[]>([]), [running, setRunning] = useState<StepId | null>(null), [found, setFound] = useState<Insight[] | null>(null), [repro, setRepro] = useState<string | null>(null);
  const token = useRef(0), stored = s.inv.analysis, current = analysisCurrent(stored, x?.id, weights);
  useEffect(() => { token.current++; setResults([]); setFound(null); setRunning(null); setRepro(null); }, [x?.id, s.inv.profile, JSON.stringify(s.inv.weights)]); // eslint-disable-line react-hooks/exhaustive-deps
  const input: AnalysisInput | null = useMemo(() => (b && x && s.shard && shardReady ? { bundle: b, target: x, shard: s.shard, weights, profile: s.inv.profile, validation: s.validation, atlas: s.atlas, space: s.space } : null), [b, x, s.shard, shardReady, JSON.stringify(weights), s.inv.profile, s.validation, s.atlas, s.space]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    if (!input || running) return; const my = ++token.current, st: RunState = {}, out: StepResult[] = []; setResults([]); setFound(null); setRepro(null);
    for (const step of STEPS) {
      setRunning(step.id);
      // Yield so the visitor sees which computation is executing; the time shown is the computation's own.
      await new Promise(r => window.setTimeout(r, reduced() ? 0 : 220));
      if (my !== token.current) return;
      const r = runStep(step.id, input, st); out.push(r); setResults([...out]);
    }
    setRunning(null);
    if (st.space && !usePlanet.getState().space) usePlanet.getState().set({ space: st.space });
    const rec = toRecord(input, st, out, nowUtc()), prev = usePlanet.getState().inv.analysis;
    if (prev && prev.target === rec.target && prev.weightsKey === rec.weightsKey) setRepro(prev.top10.join() === rec.top10.join() ? `${t('Reproduced: the top-10 Earth windows are identical to the run of')} ${utcShort(prev.ranUtc)}.` : `${t('Different from the run of')} ${utcShort(prev.ranUtc)}: ${t('the index or inputs changed.')}`);
    usePlanet.getState().patchInv({ analysis: rec });
    usePlanet.getState().log('analysis', `Ran the site analysis for ${rec.target} under “${b!.profiles[input.profile]?.label ?? input.profile}”: verdict ${rec.verdict}; leading Earth window ${rec.top10[0] ?? 'none'}`, rec.target);
    setFound(insights(input, st, out));
  };
  if (!x || !b) return <div className="xp-msg" role="status">{s.discoveryError ?? t('Loading the measured site index…')}</div>;
  const shown: { tone: string; title: string; text: string }[] = found ? found.map(z => ({ tone: z.tone === 'lead' || z.tone === 'good' ? 'info' : z.tone, title: z.title, text: z.text }))
    : stored && current ? stored.findings.map(f => ({ tone: f.severity === 'reject' ? 'risk' : f.severity === 'caution' ? 'caution' : 'info', title: f.title, text: f.detail })) : [];
  const hasResult = results.length === STEPS.length || (!!stored && current && !running && !results.length);
  const verdict = found ? usePlanet.getState().inv.analysis?.verdict : stored?.verdict, leader = (found ? usePlanet.getState().inv.analysis : stored)?.top10[0];
  const totalMs = results.reduce((a, r) => a + r.ms, 0), nRisk = shown.filter(z => z.tone === 'risk').length, nCaution = shown.filter(z => z.tone === 'caution').length;
  const leaderName = leader ? (() => { const k = b.windows.id.indexOf(leader); return k >= 0 ? `${b.windows.name[k]}${b.windows.country[k] ? ` · ${b.windows.country[k]}` : ''}` : leader; })() : null;
  return <div className="xp-analysis xp-focus">
    <StepHead step="analysis">{short(x.name)} · {x.dem}</StepHead>

    {/* 1 — the question */}
    <section className="xp-q" aria-label={t('Mission question')}>
      <h2 className="xp-label">{t('What is the mission asking?')}</h2>
      <div className="xp-chips-row" role="radiogroup" aria-label={t('Mission question')}>{Object.entries(b.profiles).map(([k, p]) => <button key={k} role="radio" aria-checked={s.inv.profile === k} className={s.inv.profile === k ? 'on' : ''} disabled={!!running}
        onClick={() => { if (s.inv.profile === k) return; s.patchInv({ profile: k, weights: null }); s.log('profile', `Set the mission question to “${p.label}”`); }}>{t(p.label)}</button>)}</div>
      <p className="xp-q-meaning">{t(PROFILE_MEANING[s.inv.profile] ?? '')}</p>
      <More label="Why this matters"><p>{t('The question sets how much each kind of resemblance counts. It is a preference, not a measurement — and the analysis tests how much the answer depends on it.')}</p></More>
      {s.inv.weights && <p className="xp-warn">{t('Custom weights are active.')} <button className="xp-link" onClick={() => s.patchInv({ weights: null })}>{t('Reset to the profile')}</button></p>}
    </section>

    {/* 2 — run */}
    <div className="xp-runbar">
      <button className="eg-button xp-run" onClick={run} disabled={!input || !!running}>{running ? <><LoaderCircle size={15} className="xp-spin" />{t('Running…')} {results.length}/{STEPS.length}</> : results.length || current ? <><RotateCcw size={15} />{t('Run again')}</> : <>{t('Run the analysis')}<ArrowRight size={16} strokeWidth={1.6} /></>}</button>
      <div className="xp-runbar-steps" aria-hidden="true">{STEPS.map(step => { const r = results.find(z => z.id === step.id); return <i key={step.id} className={r ? (r.ok ? 'done' : 'failed') : running === step.id ? 'running' : hasResult ? 'done' : ''} />; })}</div>
      <span className="xp-dim xp-small">{!shardReady ? `${t('Loading the per-window scores for')} ${x.id}…` : results.length === STEPS.length ? `${STEPS.length} ${t('computations')} · ${fmtMs(totalMs)} · ${t('in this browser')}` : stored && current && !results.length ? `${t('Analysed')} ${utcShort(stored.ranUtc)}` : t('Eight computations, in this browser, no language model.')}</span>
    </div>
    {stored && !current && !running && <p className="xp-warn">{t('The last analysis no longer matches the site or the question. Run again before relying on it.')}</p>}
    {repro && <p className="xp-repro" role="status"><ShieldCheck size={15} />{repro}</p>}

    {/* 3 — the answer first */}
    {hasResult && verdict && <section className="xp-summary" aria-label={t('Result')}>
      <div className={`xp-verdict-big v-${verdict}`}><span className="xp-label">{t('Critic verdict')}</span><b>{t(verdict)}</b></div>
      <div><span className="xp-label">{t('Closest Earth analog')}</span><b className="xp-sum-v">{leaderName ?? '—'}</b></div>
      <div><span className="xp-label">{t('Findings')}</span><b className="xp-sum-v">{nRisk > 0 && <i className="sev r">{nRisk}</i>}{nCaution > 0 && <i className="sev c">{nCaution}</i>}<i className="sev i">{shown.length - nRisk - nCaution}</i></b></div>
    </section>}
    {shown.length > 0 && <section className="xp-found" aria-label={t('Findings')}>
      <h2 className="xp-label">{t('What the analysis found')}</h2>
      <ul className="xp-cards">{shown.map(z => <li key={z.title} className={`t-${z.tone}`}>
        <span className="xp-card-ico">{z.tone === 'risk' ? <TriangleAlert size={16} /> : z.tone === 'caution' ? <CircleAlert size={16} /> : <Check size={16} />}</span>
        <div><b>{trTitle(z.title)}</b><More label="Explain">{<p>{z.text}</p>}</More></div></li>)}</ul>
    </section>}

    {/* 4 — how it was computed (open any step) */}
    <section className="xp-howbox" aria-label={t('Analysis steps')}>
      <h2 className="xp-label">{t('How it was computed')}</h2>
      <ol className="xp-tl" aria-live="polite">{STEPS.map((step, i) => { const r = results.find(z => z.id === step.id), state = r ? (r.ok ? 'done' : 'failed') : running === step.id ? 'running' : 'queued';
        return <li key={step.id} className={`s-${state}`}>
          <details>
            <summary>
              <span className="xp-tl-ico" aria-hidden="true">{state === 'done' ? <Check size={13} /> : state === 'failed' ? <CircleAlert size={13} /> : state === 'running' ? <LoaderCircle size={13} className="xp-spin" /> : <CircleDashed size={13} />}</span>
              <span className="xp-tl-n">{String(i + 1).padStart(2, '0')}</span><b>{t(step.title)}</b>{r && <span className="xp-ms">{fmtMs(r.ms)}</span>}<ChevronRight size={14} className="xp-more-arrow" aria-hidden="true" />
              {r && <span className="xp-tl-sum">{r.summary}</span>}
            </summary>
            <div className="xp-tl-body">
              <p className="xp-method">{t(step.method)}<span> · {step.data(input ?? ({ bundle: b, target: x, weights, profile: s.inv.profile, validation: s.validation, atlas: s.atlas, space: s.space } as AnalysisInput))}</span></p>
              {r && r.facts.length > 0 && <dl className="xp-facts">{r.facts.map(f => <div key={f.label}><dt>{f.label}</dt><dd>{f.value}<em className={`xp-ev ev-${f.evidence}`}>{f.evidence}</em></dd></div>)}</dl>}
              {r?.detail && r.detail.length > 0 && <ul className="xp-notes">{r.detail.map(d => <li key={d}>{d}</li>)}</ul>}
              {!r && <p className="xp-dim">{t('Not run yet.')}</p>}
            </div>
          </details>
        </li>; })}</ol>
    </section>

    {(found || current) && <More label="Ask about these results" className="xp-ask-more"><AskPanel title="" /></More>}
    <StepFooter step="analysis" ready={!!current || !!found} why="One site is never the whole story. See how the other measured sites on this world compare before committing." />
  </div>;
}
