import type { Fact, FactClass } from '../world/intelligence/tools';

const CLASS_LABEL: Record<FactClass, string> = { measured: 'Measured', derived: 'Derived', model: 'Model', simulated: 'Simulated', assumed: 'Assumed', unknown: 'Not known', retrieved: 'Retrieved', hypothesis: 'Hypothesis' };
const CLASS_HINT: Record<FactClass, string> = {
  measured: 'Value from the measured DEM (or its filtered pyramid levels)', derived: 'Deterministically computed from measured data', model: 'Output of a registered model; heuristic, not validated',
  simulated: 'Output of the physics/ephemeris simulation under stated assumptions', assumed: 'Parameter taken from literature or a scenario, not measured here', unknown: 'Not available from the packaged data',
  retrieved: 'Retrieved from the curated knowledge base (cited)', hypothesis: 'Computational hypothesis — not a discovery',
};

export function ClassBadge({ cls }: { cls: FactClass }) {
  return <span className={`astral-class c-${cls}`} title={CLASS_HINT[cls]}>{CLASS_LABEL[cls]}</span>;
}

export function FactList({ facts, compact }: { facts: Fact[]; compact?: boolean }) {
  if (!facts.length) return null;
  return <dl className={`astral-facts ${compact ? 'compact' : ''}`}>
    {facts.map((f, i) => <div key={`${f.label}-${i}`} className="astral-fact">
      <dt>{f.label}<ClassBadge cls={f.cls} /></dt>
      <dd>{f.value}{f.note && <small>{f.note}</small>}</dd>
    </div>)}
  </dl>;
}
