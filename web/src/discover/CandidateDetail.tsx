// Candidate detail: dimension profile, evidence, uncertainty, rarity, operational axis,
// computed gaps, rover experiment and a reproducible dossier export.
import { useEffect, useMemo, useState } from 'react';
import { Check, Download, FlaskConical, GitCompareArrows, Mountain, Plus, TriangleAlert, X } from 'lucide-react';
import { t } from '../i18n';
import { downloadJson, downloadText } from '../lib/download';
import { useAppStore } from '../state/store';
import { CdfChart, IntervalBar, Radar, SHORT } from './charts';
import { col, gapLedger, isWeakMatch, roverExperiment, sha256Hex, slopeCdf, text, type Aggregate } from './engine';
import type { DiscoveryBundle, GapRow, RoverBodyModel, RoverExperiment, ScoreShard, ShortlistEntry, TargetEntry, ValidationDoc } from './types';
import { usePlanet } from '../planet/workspace/store';

export interface DetailProps {
  bundle: DiscoveryBundle; target: TargetEntry; shard: ScoreShard; agg: Aggregate; i: number; rank: number;
  weights: Record<string, number>; profile: string; dimPct: (d: string, v: number) => number; scorePct: (v: number) => number;
  entry: ShortlistEntry | undefined; validation: ValidationDoc | null; inCompare: boolean;
  onCompare(): void; onClose(): void;
}

const f = (v: number | null | undefined, d = 2) => v == null || !Number.isFinite(v) ? '—' : v.toFixed(d);
const pctTxt = (v: number) => Number.isFinite(v) ? `${v.toFixed(0)}` : '—';
const STATUS_TEXT: Record<string, string> = { measured: 'measured', missing: 'no data here', not_assessed: 'not assessed', not_applicable: 'not applicable' };
const show = (v: unknown): string => Array.isArray(v) ? v.map(x => show(x)).join(' – ') : typeof v === 'number' ? (v !== 0 && Math.abs(v) < 1e-3 ? v.toExponential(2) : String(+v.toPrecision(4))) : v == null ? '—' : String(v);

export function useCandidate(p: DetailProps) {
  const { bundle, target, shard, i, entry } = p;
  return useMemo(() => {
    const dims = shard.dims.map((d, k) => ({ id: d, dim: bundle.dimensions.find(x => x.id === d)!, s50: shard.s50[k][i], lo: shard.lo[k][i], hi: shard.hi[k][i], status: shard.status_codes[shard.status[k][i]] }));
    const gaps: GapRow[] = entry?.gaps ?? gapLedger(bundle, target.body, target.lat, i, shard.w1_deg[i]);
    const cdf100 = slopeCdf(n => col(bundle, n, i), 100);
    const rover: RoverExperiment | null = entry?.rover ?? (cdf100 ? roverExperiment(cdf100, target.body, bundle.windows.id[i]) : null);
    const cdfB = slopeCdf(n => col(bundle, n, i), target.fine_baseline_m);
    return { dims, gaps, rover, cdfB };
  }, [bundle, target, shard, i, entry]);
}

export function CandidateDetail(p: DetailProps) {
  const { bundle, target, agg, i, rank } = p;
  const navigate = useAppStore(s => s.navigate);
  const c = useCandidate(p);
  const W = bundle.windows;
  const id = W.id[i];
  const measured = c.dims.filter(d => d.status === 'measured');
  const trafficable = (col(bundle, 'slope_f100_bin_0_5_frac', i) ?? NaN) + (col(bundle, 'slope_f100_bin_5_15_frac', i) ?? NaN);
  const elev = col(bundle, 'elev_p50_m', i);
  const pool = String(W.pool[i]);
  const worldDir = `earth-${id.toLowerCase()}`;
  const [hasWorld, setHasWorld] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(`${import.meta.env.BASE_URL}world/index.json`).then(r => r.ok ? r.json() : null)
      .then(ix => { if (alive) setHasWorld(!!ix?.sites?.some((x: { dir: string }) => x.dir === worldDir)); }).catch(() => { if (alive) setHasWorld(false); });
    return () => { alive = false; };
  }, [worldDir]);
  return <section className="dc-detail" aria-labelledby="dc-detail-title">
    <header className="dc-detail-head">
      <div>
        <p className="eg-eyebrow">{t('Candidate')} #{rank} · {pool.replace('_', ' ')} · {String(W.country[i] ?? '—')}</p>
        <h2 id="dc-detail-title">{String(W.name[i])}</h2>
        {isWeakMatch(agg.fidelity[i], agg.lo[i]) && <p className="dc-weak-note"><TriangleAlert size={13} /> {rank === 1 ? t('Closest found — weak match.') : t('Weak match.')} {t('Fidelity')} {agg.fidelity[i].toFixed(2)} [90 % {agg.lo[i].toFixed(2)}–{agg.hi[i].toFixed(2)}]: {t('this is the nearest Earth window found, not a demonstrated analog.')}</p>}
        <p className="dc-mono">{id} · {W.lat[i].toFixed(3)}°, {W.lon[i].toFixed(3)}° · {t('22 km window')} · {String(W.coverage_level[i])} · QA {String(W.quality[i])}</p>
      </div>
      <div className="dc-actions">
        <button className="eg-button eg-button-ghost" onClick={p.onCompare} aria-pressed={p.inCompare}><GitCompareArrows size={15} />{p.inCompare ? t('In comparison') : t('Compare')}</button>
        <MissionAnalogButton target={p.target.id} windowId={p.bundle.windows.id[p.i]} />
        <button className="eg-button eg-button-ghost" onClick={() => exportDossier(p, c, 'md')}><Download size={15} />{t('Dossier')} .md</button>
        <button className="eg-button eg-button-ghost" onClick={() => exportDossier(p, c, 'json')}><Download size={15} />.json</button>
        <button className="dc-icon" onClick={p.onClose} aria-label={t('Close candidate')}><X size={16} /></button>
      </div>
    </header>

    <div className="dc-scorebar">
      <div><span className="eg-eyebrow">{t('Score')}</span><strong>{f(agg.score[i], 3)}</strong><small>{t('Earth-wide percentile')} {pctTxt(p.scorePct(agg.score[i]))}</small></div>
      <div><span className="eg-eyebrow">{t('Scientific fidelity')}</span><strong>{f(agg.fidelity[i])}</strong><small>90 % {f(agg.lo[i])}–{f(agg.hi[i])}</small></div>
      <div><span className="eg-eyebrow">{t('Evidence coverage')}</span><strong>{f(agg.coverage[i])}</strong><small>{t('of weighted dimensions measured')}</small></div>
      <div><span className="eg-eyebrow">{t('Evidence')}</span><strong className={`dc-cat dc-cat-${agg.category[i]}`}>{t(agg.category[i].replace('_', ' '))}</strong><small>{t(categoryNote(agg.category[i]))}</small></div>
    </div>

    <div className="dc-cols">
      <div>
        <h3>{t('Dimension profile')}</h3>
        <Radar axes={measured.map(d => t(SHORT[d.id] ?? d.dim.label))} series={[{ label: String(W.name[i]), values: measured.map(d => d.s50) }]} />
        <p className="dc-note">{t('1.0 = indistinguishable from the target on that dimension. Only measured dimensions are drawn.')}</p>
      </div>
      <div>
        <h3>{t('Per-dimension evidence')}</h3>
        <table className="dc-table">
          <thead><tr><th>{t('Dimension')}</th><th>{t('Similarity (90 %)')}</th><th>{t('Earth pct')}</th></tr></thead>
          <tbody>{c.dims.map(d => <tr key={d.id} className={d.status !== 'measured' ? 'dc-row-off' : ''}>
            <th scope="row" title={d.dim.method || d.dim.reason}>{t(d.dim.label)}<small>{t(STATUS_TEXT[d.status])}{(p.weights[d.id] ?? 0) === 0 ? ` · ${t('weight 0')}` : ''}</small></th>
            <td>{d.status === 'measured' ? <><IntervalBar s50={d.s50} lo={d.lo} hi={d.hi} label={d.dim.label} /><span className="dc-mono">{f(d.s50)} <small>[{f(d.lo)}–{f(d.hi)}]</small></span></> : <span className="dc-muted">{d.status === 'not_assessed' ? t('no dataset') : d.status === 'not_applicable' ? t('physics differs') : t('no data for this window')}</span>}</td>
            <td className="dc-mono">{d.status === 'measured' && d.s50 != null ? pctTxt(p.dimPct(d.id, d.s50)) : '—'}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </div>

    <div className="dc-cols">
      <div>
        <h3>{t('Slope distribution')} · {target.fine_baseline_m} m {t('baseline')}</h3>
        <CdfChart series={[{ label: target.name.split('(')[0].trim(), cdf: target.target_slope_cdf }, { label: String(W.name[i]), cdf: c.cdfB }]} />
        <p className="dc-note">{t('Matched baseline on both bodies. W1 distance')} = {f(p.shard.w1_deg[i])}°. {target.body === 'mars' ? t('The Mars blend DEM is smoother than its 200 m posting; its slopes are biased low.') : ''}</p>
      </div>
      <div>
        <h3>{t('Context, rarity and novelty')}</h3>
        <dl className="dc-dl">
          <dt>{t('Terrain rarity')}</dt><dd>{t('rarer than')} {f(col(bundle, 'rarity_terrain_pct', i), 1)} % {t('of lattice windows')}</dd>
          <dt>{t('Environment rarity')}</dt><dd>{t('rarer than')} {f(col(bundle, 'rarity_env_pct', i), 1)} %</dd>
          <dt>{t('Novelty')}</dt><dd>{t(String(W.novelty_class[i]).replace('_', ' '))} · {f(col(bundle, 'novelty_km', i), 0)} km {t('to')} {bundle.benchmark_sites.find(b => b.id === text(bundle, 'nearest_established', i))?.name ?? text(bundle, 'nearest_established', i)}</dd>
          <dt>{t('Map lithology')}</dt><dd>{text(bundle, 'geo_lith_label', i) ?? '—'} <small>({text(bundle, 'geo_map_scale_label', i) ?? '—'} {t('scale, Macrostrat')})</small></dd>
          <dt>{t('Vocabulary classes')}</dt><dd>{((W.geology_classes[i] as string[]) ?? []).join(', ') || '—'}</dd>
          <dt>{t('Nearest Holocene volcano')}</dt><dd>{f(col(bundle, 'volcano_km', i), 0)} km</dd>
          <dt>{t('Nearest impact structure')}</dt><dd>{f(col(bundle, 'impact_km', i), 0)} km {text(bundle, 'impact_name', i) ? `(${text(bundle, 'impact_name', i)})` : ''}</dd>
          <dt>{t('Resembles most')}</dt><dd>{bundle.targets.find(x => x.id === text(bundle, 'best_target', i))?.name ?? '—'}</dd>
        </dl>
      </div>
    </div>

    {p.entry && <div className="dc-explain"><h3>{t('Why it ranks here')}</h3><ul>{p.entry.explanation.map((e, k) => <li key={k} className={`dc-ex-${e.kind}`}>{e.text}</li>)}</ul></div>}

    <div className="dc-cols">
      <div className="dc-ops">
        <h3>{t('Operational suitability')} <small>— {t('separate axis, never mixed into the score')}</small></h3>
        <dl className="dc-dl">
          <dt>{t('Ground below 15° (100 m)')}</dt><dd>{Number.isFinite(trafficable) ? `${(trafficable * 100).toFixed(0)} %` : '—'} <small>{t('derived, GLO-30')}</small></dd>
          <dt>{t('Built-up fraction')}</dt><dd>{f(col(bundle, 'built_frac', i), 3)} <small>{t('proxy for nearby infrastructure, WorldCover')}</small></dd>
          <dt>{t('Snow/ice fraction')}</dt><dd>{f(col(bundle, 'snow_frac', i), 3)} <small>{t('seasonal access constraint, WorldCover')}</small></dd>
          <dt>{t('Median elevation')}</dt><dd>{elev == null ? '—' : `${elev.toFixed(0)} m`}{elev != null && elev > 3500 ? ` · ${t('high-altitude logistics')}` : ''}</dd>
          <dt>{t('Access, permits, safety')}</dt><dd className="dc-muted">{t('not assessed — no data source')}</dd>
        </dl>
      </div>
      <div>
        <h3><FlaskConical size={15} /> {t('Rover experiment')} <small>— {t('model estimate')}</small></h3>
        {c.rover ? <RoverTable ex={c.rover} bodyModel={bundle.rover_body_level?.[target.body]} /> : <p className="dc-muted">{t('No 100 m slope distribution for this window.')}</p>}
        <div className="dc-links">
          <button className="eg-button eg-button-ghost" onClick={() => navigate('lab')}>{t('Test it in Mission Lab')}</button>
          <button className="eg-button eg-button-ghost" onClick={() => navigate(target.body === 'mars' ? 'astral' : 'studio')}><Mountain size={15} />{target.body === 'mars' ? t('Jezero world (ASTRAL)') : t('Lunar 5 m world')}</button>
          {hasWorld && <button className="eg-button eg-button-ghost" onClick={() => { window.location.hash = `#/astral?world=${worldDir}`; }}><Mountain size={15} />{t('This window in 3D (ASTRAL)')}</button>}
        </div>
        {!hasWorld && <p className="dc-note">{t('3D world of this window not built yet:')} <code>python -m pipeline.world.scene earth:{id}</code> {t('then')} <code>node web/scripts/copy-world.mjs</code></p>}
      </div>
    </div>

    <div>
      <h3><TriangleAlert size={15} /> {t('Computed gap ledger')}</h3>
      <div className="dc-scroll"><table className="dc-table dc-gaps">
        <thead><tr><th>{t('Parameter')}</th><th>{target.name.split('(')[0]}</th><th>{t('This window')}</th><th>{t('Earth / target')}</th><th>{t('Evidence and alternative')}</th></tr></thead>
        <tbody>{c.gaps.map(g => <tr key={g.key}>
          <th scope="row">{t(g.parameter)}<small>{g.unit !== 'text' ? g.unit : ''}</small></th>
          <td className="dc-mono">{show(g.target_value)}</td><td className="dc-mono">{show(g.earth_value)}</td>
          <td className="dc-mono">{g.ratio_earth_to_target != null ? `×${show(g.ratio_earth_to_target)}` : g.measurable ? '—' : t('not quantifiable')}</td>
          <td><small>{g.earth_evidence}{g.note ? ` · ${g.note}` : ''}{g.alternative ? ` · → ${g.alternative}` : ''}</small></td>
        </tr>)}</tbody>
      </table></div>
    </div>
  </section>;
}

function categoryNote(c: string) {
  return c === 'strong' ? 'high coverage, narrow interval' : c === 'weak' ? 'wide interval or partial coverage' : 'similarity rests on few measured dimensions';
}

function RoverTable({ ex, bodyModel }: { ex: RoverExperiment; bodyModel: RoverBodyModel | undefined }) {
  const cs = ex.cases, dm = ex.deltas.earth_mass_matched;
  return <>
    <div className="dc-rover-body">
      <p className="eg-eyebrow">{t('Body-level, model estimate')} · {t(ex.body === 'mars' ? 'same for every Earth candidate for Mars' : 'same for every Earth candidate for the Moon')}</p>
      <p className="dc-note">{t('Traction-limited slope')}: {cs.target.slope_limit_deg.toFixed(1)}° {t('at target gravity')} vs {cs.earth_mass_matched.slope_limit_deg.toFixed(1)}° {t('in a mass-matched Earth test')} (Δ {dm.d_slope_limit_deg.toFixed(1)}°) · {t('wheel sinkage')} ×{f(dm.sinkage_ratio)}. {t('Depends on gravity, rover and assumed soil only — not on this window. Also listed in the gap ledger.')}</p>
      {(ex.soil_reused_from_moon ?? bodyModel?.soil_reused_from_moon) && <p className="dc-note dc-warn"><TriangleAlert size={13} /> {t('Mars runs reuse the Apollo-era lunar soil parameters; Mars soil is unmeasured here.')}</p>}
    </div>
    <p className="eg-eyebrow">{t('Window-level')} · {t("uses this window's measured slope distribution (GLO-30, 100 m)")}</p>
    <table className="dc-table">
      <thead><tr><th /><th>{t('Traversable')}</th><th>{t('Climb energy')}</th></tr></thead>
      <tbody>{(['target', 'earth_load_matched', 'earth_mass_matched'] as const).map(k => <tr key={k}>
        <th scope="row">{t(cs[k].label)}</th>
        <td className="dc-mono">{(cs[k].traversable_frac * 100).toFixed(1)} %</td>
        <td className="dc-mono">{cs[k].climbing_energy_j_per_m == null ? '—' : `${cs[k].climbing_energy_j_per_m.toFixed(0)} J/m`}</td></tr>)}</tbody>
    </table>
    <p className="dc-note">{t('On this terrain a mass-matched Earth test mis-states the traversable fraction by')} {(dm.d_traversable_frac * 100).toFixed(1)} {t('points and climbing energy by')} ×{f(dm.energy_ratio)}. {t('Static Bekker model with assumed soil; not a hardware result.')}</p>
  </>;
}

async function exportDossier(p: DetailProps, c: ReturnType<typeof useCandidate>, kind: 'md' | 'json') {
  const { bundle, target, agg, i } = p;
  const W = bundle.windows, id = W.id[i];
  const window = Object.fromEntries(Object.keys(W).map(k => [k, W[k][i]]));
  const v = p.validation?.targets.find(x => x.target === target.id);
  const body = {
    schema: 'egiz.discovery_dossier', version: '1.0.0', synthetic: false,
    bundle: { version: bundle.version, content_sha256: bundle.content_sha256, generated_at: bundle.generated_at, inputs: bundle.inputs },
    target: { id: target.id, name: target.name, body: target.body, lat: target.lat, lon: target.lon, dem: target.dem, fingerprint: target.fingerprint },
    candidate: { id, rank: p.rank, window },
    weights: { profile: p.profile, values: p.weights },
    result: { score: agg.score[i], fidelity: agg.fidelity[i], interval_90: [agg.lo[i], agg.hi[i]], coverage: agg.coverage[i], category: agg.category[i] },
    dimensions: c.dims.map(d => ({ id: d.id, label: d.dim.label, status: d.status, s50: d.s50, lo: d.lo, hi: d.hi, method: d.dim.method || d.dim.reason })),
    explanation: p.entry?.explanation ?? null, gap_ledger: c.gaps, rover_experiment: c.rover,
    validation: v ? { auc: v.metrics.auc, auc_90ci: v.metrics.auc_90ci, positives: v.positives, caveats: p.validation!.caveats } : null,
    evidence_classes: { measured: 'observed source values', derived: 'computed from measurements', modelled: 'reanalysis / climatology', proxy: 'map or class categories', simulated: 'model estimates (rover)', assumed: 'declared parameters' },
    reproduce: bundle.reproduce,
  };
  const hash = await sha256Hex(JSON.stringify(body));
  if (kind === 'json') { downloadJson({ ...body, dossier_sha256: hash }, `egiz-dossier-${target.id}-${id}.json`); return; }
  const lines = [
    `# EGIZ discovery dossier — ${W.name[i]} for ${target.name}`, '',
    `Bundle ${bundle.version} (sha256 ${bundle.content_sha256.slice(0, 16)}…), dossier sha256 ${hash.slice(0, 16)}…. Not synthetic.`, '',
    `**Candidate** ${id} · ${W.lat[i].toFixed(4)}°, ${W.lon[i].toFixed(4)}° · ${W.country[i] ?? '—'} · rank ${p.rank} (profile ${p.profile})`, '',
    `**Score** ${agg.score[i].toFixed(3)} = fidelity ${agg.fidelity[i].toFixed(2)} [90 % ${agg.lo[i].toFixed(2)}–${agg.hi[i].toFixed(2)}] × coverage ${agg.coverage[i].toFixed(2)} — ${agg.category[i]} evidence`, '',
    '## Dimensions', '', '| Dimension | Status | Similarity | 90 % interval |', '|---|---|---|---|',
    ...c.dims.map(d => `| ${d.dim.label} | ${d.status} | ${f(d.s50)} | ${f(d.lo)}–${f(d.hi)} |`), '',
    ...(p.entry ? ['## Explanation', '', ...p.entry.explanation.map(e => `- ${e.text}`), ''] : []),
    '## Computed gap ledger', '', '| Parameter | Target | Earth window | Unit | Evidence |', '|---|---|---|---|---|',
    ...c.gaps.map(g => `| ${g.parameter} | ${show(g.target_value)} | ${show(g.earth_value)} | ${g.unit} | ${g.earth_evidence}${g.note ? `; ${g.note}` : ''} |`), '',
    ...(c.rover ? ['## Rover experiment (model estimate)', '',
      `Body-level (identical for every Earth candidate on this body): slope limit ${c.rover.cases.target.slope_limit_deg.toFixed(1)}° at target gravity vs ${c.rover.cases.earth_mass_matched.slope_limit_deg.toFixed(1)}° in a mass-matched Earth test; sinkage ×${f(c.rover.deltas.earth_mass_matched.sinkage_ratio)}.`, '',
      "Window-level (this window's measured slope distribution):", '',
      ...(['target', 'earth_load_matched', 'earth_mass_matched'] as const).map(k => `- ${c.rover!.cases[k].label}: traversable ${(c.rover!.cases[k].traversable_frac * 100).toFixed(1)} %, climbing energy ${c.rover!.cases[k].climbing_energy_j_per_m == null ? '—' : c.rover!.cases[k].climbing_energy_j_per_m!.toFixed(0) + ' J/m'}`),
      ...(c.rover.soil_note ? [`- Soil: ${c.rover.soil_note}`] : []), ...c.rover.assumptions.map(a => `- Assumption: ${a}`), ''] : []),
    ...(v ? ['## Validation of the method for this target', '', `ROC AUC ${v.metrics.auc} (90 % CI ${JSON.stringify(v.metrics.auc_90ci)}) for ${v.positives.length} published analog sites.`, ...p.validation!.caveats.map(x => `- ${x}`), ''] : []),
    '## Reproduce', '', ...bundle.reproduce.map(r => `    ${r}`), '',
  ];
  downloadText(lines.join('\n'), `egiz-dossier-${target.id}-${id}.md`);
}

export function ComparePanel({ bundle, shard, agg, ids, onRemove, target }: { bundle: DiscoveryBundle; shard: ScoreShard; agg: Aggregate; ids: string[]; onRemove(id: string): void; target: TargetEntry }) {
  const list = ids.map(id => bundle.windows.id.indexOf(id)).filter(i => i >= 0);
  if (!list.length) return null;
  const measured = shard.dims.filter(d => target.dimension_status[d] === 'measured');
  const label = (d: string) => bundle.dimensions.find(x => x.id === d)?.label ?? d;
  return <section className="dc-compare" aria-labelledby="dc-compare-title">
    <h2 id="dc-compare-title"><GitCompareArrows size={16} /> {t('Comparison')} <small>({list.length}/3)</small></h2>
    <div className="dc-cols">
      <Radar axes={measured.map(d => t(SHORT[d] ?? label(d)))} series={list.map(i => ({ label: String(bundle.windows.name[i]), values: measured.map(d => { const k = shard.dims.indexOf(d); return shard.status[k][i] === 0 ? shard.s50[k][i] : null; }) }))} />
      <div className="dc-scroll"><table className="dc-table">
        <thead><tr><th>{t('Dimension')}</th>{list.map(i => <th key={i}>{String(bundle.windows.name[i])}<button className="dc-icon" onClick={() => onRemove(bundle.windows.id[i])} aria-label={`${t('Remove')} ${bundle.windows.id[i]}`}><X size={12} /></button></th>)}</tr></thead>
        <tbody>
          {shard.dims.map((d, k) => <tr key={d} className={target.dimension_status[d] !== 'measured' ? 'dc-row-off' : ''}><th scope="row">{t(label(d))}</th>
            {list.map(i => <td key={i} className="dc-mono">{shard.status[k][i] === 0 ? `${f(shard.s50[k][i])} [${f(shard.lo[k][i])}–${f(shard.hi[k][i])}]` : t(shard.status_codes[shard.status[k][i]].replace('_', ' '))}</td>)}</tr>)}
          <tr><th scope="row">{t('Score')}</th>{list.map(i => <td key={i} className="dc-mono"><b>{f(agg.score[i], 3)}</b></td>)}</tr>
          <tr><th scope="row">{t('Coverage')}</th>{list.map(i => <td key={i} className="dc-mono">{f(agg.coverage[i])}</td>)}</tr>
          <tr><th scope="row">{t('Evidence')}</th>{list.map(i => <td key={i}>{t(agg.category[i].replace('_', ' '))}</td>)}</tr>
          <tr><th scope="row">{t('Terrain rarity')}</th>{list.map(i => <td key={i} className="dc-mono">{f(col(bundle, 'rarity_terrain_pct', i), 1)} %</td>)}</tr>
          <tr><th scope="row">{t('Novelty')}</th>{list.map(i => <td key={i}>{t(String(bundle.windows.novelty_class[i]).replace('_', ' '))}</td>)}</tr>
          <tr><th scope="row">{t('Precipitation')}</th>{list.map(i => <td key={i} className="dc-mono">{f(col(bundle, 'precip_annual_mm', i), 0)} mm</td>)}</tr>
          <tr><th scope="row">{t('Bare ground')}</th>{list.map(i => <td key={i} className="dc-mono">{f(col(bundle, 'bare_frac', i))}</td>)}</tr>
        </tbody>
      </table></div>
    </div>
  </section>;
}

/** Keep this window as an Earth analog of the mission when the mission's site is the target being searched. */
function MissionAnalogButton({ target, windowId }: { target: string; windowId: string }) {
  const site = usePlanet(s => s.inv.target), kept = usePlanet(s => s.inv.candidates.includes(windowId) && s.inv.analogsFor === target);
  if (site !== target) return null;
  return <button className="eg-button eg-button-ghost" aria-pressed={kept} onClick={() => usePlanet.getState().toggleCandidate(windowId)}>{kept ? <Check size={15} /> : <Plus size={15} />}{t(kept ? 'Mission analog' : 'Keep as mission analog')}</button>;
}
