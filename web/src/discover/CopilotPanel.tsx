// Research assistant panel. Offline tool planner by default; when the deployment exposes the
// server-side LLM proxy (/api/copilot) the same allowlisted tools are driven by the model.
import { useEffect, useState } from 'react';
import { Bot, Send } from 'lucide-react';
import { t } from '../i18n';
import { answerOffline, type Answer, type ToolContext } from './copilot';
import { askServerLlm, serverLlmStatus } from './llm';

const SUGGESTIONS = ['Top candidates in Kazakhstan', 'Why does the selected window rank here?', 'Where does the analogy fail?',
  'How uncertain is this result?', 'Recommend a rover simulation', 'Compare the selected candidates', 'How was the method validated?', 'Target fingerprint'];

export function CopilotPanel({ ctx, onSelect }: { ctx: ToolContext; onSelect(id: string): void }) {
  const [q, setQ] = useState('');
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [busy, setBusy] = useState(false);
  const [llm, setLlm] = useState<{ available: boolean; model?: string }>({ available: false });
  const [useLlm, setUseLlm] = useState(false);
  useEffect(() => { serverLlmStatus().then(setLlm).catch(() => setLlm({ available: false })); }, []);
  const ask = async (text: string) => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const a = useLlm && llm.available ? await askServerLlm(text, ctx).catch(e => ({ ...answerOffline(text, ctx), error: `LLM unavailable (${(e as Error).message}); answered with the offline tool planner.` })) : answerOffline(text, ctx);
      setAnswers(prev => [a, ...prev].slice(0, 12));
      setQ('');
    } finally { setBusy(false); }
  };
  return <section className="dc-copilot" aria-labelledby="dc-copilot-title">
    <header><h2 id="dc-copilot-title"><Bot size={16} /> {t('Research assistant')}</h2>
      <p className="dc-note">{t('Answers come only from allowlisted analysis tools over the measured bundle; every number is a tool output.')}</p>
      <label className="dc-toggle"><input type="checkbox" checked={useLlm && llm.available} disabled={!llm.available} onChange={e => setUseLlm(e.target.checked)} />
        {llm.available ? `${t('Language model via server')} (${llm.model})` : t('Language model not configured on this deployment — offline tool planner active')}</label>
    </header>
    <form onSubmit={e => { e.preventDefault(); void ask(q); }} className="dc-ask">
      <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('Ask about the target, a candidate, gaps, uncertainty…')} aria-label={t('Question for the research assistant')} />
      <button className="eg-button" disabled={busy || !q.trim()} aria-label={t('Ask')}><Send size={15} /></button>
    </form>
    <div className="dc-chips">{SUGGESTIONS.map(s => <button key={s} onClick={() => void ask(t(s))} disabled={busy}>{t(s)}</button>)}</div>
    <ol className="dc-answers" aria-live="polite">
      {answers.map(a => <li key={a.id}>
        <p className="dc-q">{a.question} <small>· {a.provider === 'llm' ? t('language model + tools') : t('offline tools')}</small></p>
        {a.error && <p className="dc-warn">{a.error}</p>}
        {a.narrative && <p className="dc-narr">{a.narrative}</p>}
        {a.results.map((r, k) => <div key={k} className={`dc-tool ${r.ok ? '' : 'dc-tool-fail'}`}>
          <p><code>{r.tool}</code> {r.summary}</p>
          {r.facts.length > 0 && <table className="dc-table"><tbody>{r.facts.map((fct, j) => <tr key={j}><th scope="row">{fct.label}</th><td className="dc-mono">{fct.value}</td><td><small>{fct.evidence}</small></td></tr>)}</tbody></table>}
          {r.notes.map((n, j) => <p key={j} className="dc-note">{n}</p>)}
          {r.windows && r.windows.length > 0 && <div className="dc-chips">{r.windows.slice(0, 8).map(w => <button key={w} onClick={() => onSelect(w)}>{w}</button>)}</div>}
        </div>)}
      </li>)}
    </ol>
  </section>;
}
