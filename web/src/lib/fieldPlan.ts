import type { AppData, EarthTile, MissionTemplate, Run, Target } from '../types/contracts';
import { attrLabels, attrValue, siteName } from './format';

/** An evidence checklist; no routes, permissions, safety, geology or measurements are invented. */
export function fieldPlan(data: AppData, target: Target, tile: EarthTile, template: MissionTemplate, run: Run): string {
  const lines = [
    `# EGIZ field verification plan — ${siteName(tile)}`,
    '', `Target: ${target.name} (${target.body}).`,
    `Earth window center: ${tile.lat}°, ${tile.lon}°. Analysis footprint: regional 20 × 20 km; fine terrain 10 × 10 km.`,
    `Data status: ${data.results.synthetic ? 'SYNTHETIC SOFTWARE FIXTURES — no field recommendation' : 'Measured terrain pilot — exploratory and unvalidated'}.`,
    '', '## Research question', '',
    'Do independently collected terrain observations support the model comparisons below at the same spatial baselines? This checklist proposes observations; it does not establish suitability or grant field access.',
    '', '## Model evidence and measurements to verify', '',
  ];
  for (const objective of template.objectives) {
    const cell = run.fidelity[objective.id]?.[tile.id];
    lines.push(`### ${objective.name}`, '', `Objective fidelity: ${cell?.F == null ? 'unavailable' : cell.F.toPrecision(6)}${cell?.F != null && cell.partial ? ' (partial evidence)' : ''}.`, '');
    for (const spec of objective.attributes) {
      const earth = tile.attrs[spec.attr as keyof typeof tile.attrs], planet = target.attrs[spec.attr as keyof typeof target.attrs];
      const terrain = /^(slope_|frac_lt|tri_|relief_|elev_)/.test(spec.attr);
      lines.push(`- ${attrLabels[spec.attr] ?? spec.attr}: Earth ${spec.attr === 'light' ? 'derived solar model (not an observation)' : attrValue(spec.attr, earth)}; target ${spec.attr === 'light' ? 'modeled solar-height limit' : attrValue(spec.attr, planet)}.`);
      if (terrain) lines.push(`  Verification: acquire independently surveyed elevations and source quality flags; reproduce ${spec.attr.includes('f100') ? '100 m' : spec.attr.includes('f400') ? '400 m' : /^(relief_|elev_)/.test(spec.attr) ? '20 km footprint elevation' : 'regional 2 km'} baseline metrics over the same documented core. Record CRS, vertical datum, sampling, nodata and uncertainty.`);
      else if (spec.attr === 'light') lines.push('  Verification: record time-tagged geometric Sun elevation, azimuth and local horizon obstruction. Separately record weather and snow; the latitude-band model does not predict them.');
      else lines.push('  Verification: obtain a location-specific, quality-controlled observation and its temporal coverage. Missing inputs remain unassessed; do not infer them from terrain appearance.');
    }
    lines.push('');
  }
  lines.push('## Before any field visit', '',
    '- Confirm access rights, permits, local restrictions, environmental protections and safety with responsible authorities. None are assessed by EGIZ.',
    '- Have a domain scientist set a validation protocol and acceptance tolerances before collecting a new validation set; retain negative results and independent observations.',
    '- Record grain size, cohesion and surface obstacles separately. DEM slope is not a test of wheel traction, regolith mechanics or engineering traversability.',
    '- Use appropriate laboratory or simulation facilities for gravity, atmosphere, radiation and thermal conditions that Earth terrain cannot reproduce.',
    '', '## Reproducibility', '', `Target ID: ${target.id}`, `Earth ID: ${tile.id}`, `Template: ${template.id}`, '',
    ...Object.entries(data.results.inputs).map(([name, hash]) => `- ${name}: ${hash}`), '',
    '## Source registry', '', ...[...data.candidates.provenance, ...data.targets.provenance].map(p => `- ${p.dataset} (${p.provider}, ${p.version}): ${p.url}`), '',
    'Prepared automatically from recorded model inputs with AI-assisted software. No observations or human approvals are supplied by this document.', '');
  return lines.join('\n');
}
