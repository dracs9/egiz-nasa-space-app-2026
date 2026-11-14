// EGIZ · step 2, Investigate. A progressive briefing on the mission site: what the place is, what the ground is
// like, light and environment, what is measured and what is missing, and the challenges those numbers imply.
// Every value is read from the site's fingerprint in the discovery index with its evidence class and source;
// challenges are stated by fixed rules over those values, never generated.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, ChevronDown, CircleHelp, Locate, Mountain, MountainSnow, Sun, Waypoints } from 'lucide-react';
import { t, useLanguage } from '../../i18n';
import type { TargetEntry } from '../../discover/types';
import { BODY_LABEL } from '../../planet/terrain/site';
import { usePlanet } from '../../planet/workspace/store';
import { EVIDENCE_LABEL, featureValue, fingerprintRows, formatFeature, knownUnknown, STATUS_LABEL, WORLD } from '../../planet/journey/knowledge';
import type { Globe } from '../../planet/journey/globe';
import { GlobeView } from '../GlobeView';
import { SlopeCdf } from '../SlopeCdf';
import { openWorkspace } from '../nav';
import { StepFooter, StepHead } from '../ExpeditionPage';
import { fmtLat, fmtLon, KIND, short } from '../format';
import { EvidenceDots, ReliefBar, SlopeGauge, SunArc } from '../Infographics';

const CH_ICON: Record<string, typeof Sun> = { 'Steep ground': Mountain, 'Drivable slopes': Waypoints, 'The Sun stays low': Sun, 'Large relief': MountainSnow, 'No 3D terrain package': Box };

const ev = (e: string) => (e === 'physical_constraint' ? 'assumed' : e);
interface Challenge { tone: 'risk' | 'caution' | 'info'; title: string; text: string }
/** Fixed rules over the fingerprint. Thresholds are stated in the text so the reader can disagree with them. */
export function challenges(x: TargetEntry, dims: ReturnType<typeof knownUnknown>, hasTerrain: boolean): Challenge[] {
  // Sentences carry numbers, so each has an English and a Russian form; titles are dictionary keys (translated at render).
  const ru = useLanguage.getState().language === 'ru', L = (en: string, r: string) => (ru ? r : en);
  const fine = x.body === 'moon' ? 'f100' : 'f400', p90 = featureValue(x, `slope_${fine}_p90_deg`), p50 = featureValue(x, `slope_${fine}_p50_deg`), sunMax = featureValue(x, 'noon_elevation_max_deg'), relief = featureValue(x, 'relief_m');
  const out: Challenge[] = [], below15 = x.target_slope_cdf[15], base = x.fine_baseline_m;
  if (p90 !== null && p90 > 15) out.push({ tone: 'risk', title: 'Steep ground', text: L(
    `One tenth of the ground is steeper than ${p90.toFixed(1)}° at a ${base} m baseline — above the 15° slope limit used for planning rovers here.${below15 !== undefined ? ` ${Math.round(below15 * 100)} % of the measured ground is gentler than 15°.` : ''}`,
    `Десятая часть поверхности круче ${p90.toFixed(1)}° при базе ${base} м — выше предела 15°, принятого здесь для планирования роверов.${below15 !== undefined ? ` ${Math.round(below15 * 100)} % измеренной поверхности положе 15°.` : ''}`) });
  else if (p50 !== null && p90 !== null) out.push({ tone: 'info', title: 'Drivable slopes', text: L(
    `Typical slope ${p50.toFixed(1)}°, steep tail ${p90.toFixed(1)}° — inside the 15° planning limit at the ${base} m baseline. Rocks and slopes shorter than that baseline are not resolved.`,
    `Типичный уклон ${p50.toFixed(1)}°, крутой хвост ${p90.toFixed(1)}° — в пределах 15° при базе ${base} м. Камни и уклоны короче этой базы не разрешены.`) });
  if (sunMax !== null && sunMax < 10) out.push({ tone: 'caution', title: 'The Sun stays low', text: L(
    `The noon Sun never rises above ${sunMax.toFixed(1)}°: long shadows, cold traps, and solar power that depends on where exactly you stand.`,
    `Полуденное Солнце не поднимается выше ${sunMax.toFixed(1)}°: длинные тени, холодные ловушки и солнечная энергия, которая зависит от того, где именно стоишь.`) });
  if (relief !== null && relief > 2000) out.push({ tone: 'caution', title: 'Large relief', text: L(
    `${Math.round(relief).toLocaleString('en')} m between the highest and lowest point of the window: routes must be planned around massifs and crater walls.`,
    `${Math.round(relief).toLocaleString('ru')} м между самой высокой и самой низкой точкой окна: маршруты нужно прокладывать в обход массивов и стенок кратеров.`) });
  const missing = dims.filter(d => d.status !== 'measured' && d.status !== 'not_applicable');
  if (missing.length) out.push({ tone: 'caution', title: 'Dimensions without evidence', text: L(
    `${missing.length}: ${missing.map(d => d.label).join(', ')}. These cannot influence any ranking and are reported as missing coverage.`,
    `${missing.length}: ${missing.map(d => d.label).join(', ')}. Они не влияют на рейтинг и учитываются как недостающее покрытие.`) });
  if (!hasTerrain) out.push({ tone: 'info', title: 'No 3D terrain package', text: L('The fingerprint can be analysed and matched to Earth, but 3D inspection and rover simulation need a packaged elevation model.', 'Отпечаток можно проанализировать и сопоставить с Землёй, но для 3D-осмотра и моделирования ровера нужна упакованная модель рельефа.') });
  return out;
}

export function SiteStep() {
  const s = usePlanet(), b = s.bundle, x = s.inv.target ? s.target() : null;
  const [open, setOpen] = useState(1), globe = useRef<Globe | null>(null), [ready, setReady] = useState(false);
  useEffect(() => setOpen(1), [x?.id]);
  useEffect(() => { if (ready && x) globe.current?.flyTo(x.lat, x.lon, x.body === 'moon' ? 1.22 : 1.5, 1400); }, [ready, x?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const peers = useMemo(() => (b && x ? b.targets.filter(p => p.body === x.body && p.id !== x.id) : []), [b, x]);
  if (!b || !x) return <div className="xp-msg" role="status">{s.discoveryError ?? t('Loading the measured site index…')}</div>;
  const ref = s.refs.find(r => r.id === x.id), rows = fingerprintRows(x), dims = knownUnknown(b, x), measured = dims.filter(d => d.status === 'measured').length, ch = challenges(x, dims, !!ref);
  const Section = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => open >= n ? <section className="xp-brief">
    <h3><b>{String(n).padStart(2, '0')}</b>{t(title)}</h3><div className="xp-brief-body">{children}</div></section>
    : <button className="xp-brief xp-brief-closed" onClick={() => setOpen(n)}><h3><b>{String(n).padStart(2, '0')}</b>{t(title)}<ChevronDown size={14} /></h3></button>;
  const Value = ({ r }: { r: ReturnType<typeof fingerprintRows>[number] }) => <div title={`${t(r.info.explain)} ${t('Source')}: ${r.f.source}`}><dt>{t(r.info.label)}</dt><dd>{formatFeature(r.key, r.f)}<em className={`xp-ev ev-${ev(r.f.evidence)}`}>{t(EVIDENCE_LABEL[r.f.evidence] ?? r.f.evidence)}</em></dd></div>;
  return <div className="xp-site">
    <div className="xp-site-plate">
      <GlobeView body={x.body} interactive enhance={{ lat: x.lat, lon: x.lon }} markers={[...peers.map(p => ({ id: p.id, lat: p.lat, lon: p.lon, kind: 'alt' as const, label: short(p.name) })), { id: x.id, lat: x.lat, lon: x.lon, kind: 'site' as const, label: short(x.name), on: true }]} graticule={false} labels="all" onReady={g => { globe.current = g; setReady(!!g); }}>
        <p className="xp-hud xp-credit">{t('Colour mosaic for orientation — not a measurement')}</p>
      </GlobeView>
    </div>
    <div className="xp-site-text">
      <StepHead step="site" title={short(x.name)}>
        <p className="xp-coord"><Locate size={12} /> {fmtLat(x.lat)} · {fmtLon(x.lon)} · {t(KIND[x.kind] ?? x.kind)} · {t(BODY_LABEL[x.body])}</p>
      </StepHead>
      <Section n={1} title="What is this place?">
        <p className="xp-sig">{x.significance}</p>
        <p className="xp-dim">{t('Elevation model')}: {x.dem}. {t('Coordinates')}: {x.coordinate_reference}.</p>
        <p>{t(WORLD[x.body].why)}</p>
      </Section>
      <Section n={2} title="What is the ground like?">
        <div className="ig-grid"><SlopeGauge x={x} /><ReliefBar x={x} peers={peers} /></div>
        <SlopeCdf focus={x} peers={peers} />
        <dl className="xp-fp">{rows.filter(r => r.group === 'terrain').map(r => <Value key={r.key} r={r} />)}</dl>
        <p className="xp-dim xp-small">{t('Hover a value for its meaning and source.')}</p>
      </Section>
      <Section n={3} title="Light and environment">
        <div className="ig-grid"><SunArc x={x} /></div>
        <dl className="xp-fp">{rows.filter(r => r.group !== 'terrain').map(r => <Value key={r.key} r={r} />)}</dl>
        <p className="xp-dim xp-small">{t(WORLD[x.body].sunlight)} · {t('Gravity')} {WORLD[x.body].gravity} · {t('Day')} {t(WORLD[x.body].day)}</p>
      </Section>
      <Section n={4} title="What is measured — and what is missing?">
        <div className="ig-grid"><EvidenceDots b={b} x={x} /></div>
        <p>{measured} {t('of')} {dims.length} {t('comparison dimensions have evidence for this site.')}</p>
        <ul className="xp-known">{dims.map(d => <li key={d.id} className={`st-${d.status}`}><i aria-hidden="true" /><span><b>{d.label}</b><em>{t(STATUS_LABEL[d.status] ?? d.status)}</em>{d.why && <small>{d.why}</small>}</span></li>)}</ul>
      </Section>
      <Section n={5} title="Challenges these numbers imply">
        <ul className="xp-insights">{ch.map(c => { const Icon = CH_ICON[c.title] ?? CircleHelp; return <li key={c.title} className={`t-${c.tone}`}><Icon size={18} strokeWidth={1.6} /><div><b>{t(c.title)}</b><p>{c.text}</p></div></li>; })}</ul>
        <p className="xp-dim xp-small">{t('Stated by fixed rules over the measured fingerprint; thresholds are given so you can judge them.')}</p>
      </Section>
      <div className="xp-row">
        {open < 5 && <button className="eg-button quiet" onClick={() => setOpen(open + 1)}><span>{t('Continue the briefing')} ({open}/5)</span></button>}
        {open < 5 && <button className="eg-button quiet" onClick={() => setOpen(5)}><span>{t('Show everything')}</span></button>}
        {ref && <button className="eg-button quiet" onClick={() => openWorkspace('planet')}><Box size={15} /><span>{t('Descend into measured 3D terrain')} · {ref.postingM} m</span></button>}
      </div>
      <StepFooter step="site" why="You know what the place is. Next, put EGIZ’s engines to work on it." />
    </div>
  </div>;
}
