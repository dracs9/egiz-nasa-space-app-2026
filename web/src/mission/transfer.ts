import { terrainStatistics, quantile } from "./analysis.ts";
import { tipAngle } from "./mobility.ts";
import type { RunResult } from "./types.ts";

export const TRANSFER_MODEL = "egiz-mission-transfer-1.0.0";
export const OBJECTIVES = [
  { id:"terrain", label:"Route slope exposure", weight:0.30, definition:"Exp(−mean quantile slope mismatch / max(1°, 20% of configured slope limit)); target-physics Earth route." },
  { id:"load", label:"Wheel torque exposure", weight:0.30, definition:"Exp(−mean quantile wheel-torque mismatch / max(1 N m, 50% of target P90 torque)); physical Earth route." },
  { id:"power", label:"Electrical demand", weight:0.25, definition:"Exp(−mean quantile load mismatch / max(10 W, 30% of target P90 load)); physical Earth route, excluding solar generation." },
  { id:"boundary", label:"Slope-limit test terrain", weight:0.15, definition:"Fraction of valid regional slope cells between 80% and 120% of the effective slope limit, capped at 10% prevalence. Terrain opportunity only; no access guarantee." },
] as const;
type Objective = typeof OBJECTIVES[number]["id"];
export interface TransferSite {
  id: string; name: string; lon: number; lat: number;
  coverage: Record<Objective, number>;
  score: number;
  earthRunId: string; controlRunId: string;
  earthOutcome: string; controlOutcome: string;
  earthEnergyWh: number; controlEnergyWh: number;
  energyEnvironmentDeltaWh: number | null;
  geometryBaseline: number;
  source: RunResult["terrain"]["source"];
  notes: string[];
}
export interface TransferCampaign {
  model: string; targetRunId: string; sites: TransferSite[];
  selected: string[]; coverage: Record<Objective, number>; score: number;
  baselines: { geometry: {sites: string[]; score: number}; single: {sites: string[]; score: number}; greedy: {sites: string[]; score: number} };
  evaluatedCombinations: number; budget: number;
  measurements: {name: string; reason: string; priority: number}[];
  limitations: string[];
}
function values(run: RunResult, field: "slope" | "torque" | "power") {
  return run.frames.filter(f => f.speed > 0 && f.t > 0).map(f =>
    field === "slope" ? f.slope : field === "torque" ? f.mobility?.wheelTorqueNm ?? 0 : f.mobility?.electricalPowerW ?? 0).sort((a,b)=>a-b);
}
function match(a: number[], b: number[], tolerance: number) {
  if (!a.length || !b.length) return 0;
  return Math.exp(-[0.1,0.5,0.9].reduce((s,q)=>s+Math.abs(quantile(a,q)!-quantile(b,q)!),0)/(3*tolerance));
}
export function campaignCoverage(sites: TransferSite[]) {
  const coverage = Object.fromEntries(OBJECTIVES.map(o=>[o.id,Math.max(0,...sites.map(s=>s.coverage[o.id]))])) as Record<Objective,number>;
  return {coverage, score: OBJECTIVES.reduce((s,o)=>s+o.weight*coverage[o.id],0)};
}
function optimize(pool: TransferSite[], budget: number) {
  let selected: TransferSite[] = [], score = -1, count = 0;
  const visit = (from: number, items: TransferSite[]) => {
    if (items.length) {
      count++;
      const next = campaignCoverage(items).score;
      const ids = items.map(s=>s.id).join("|");
      if (next > score+1e-12 || (Math.abs(next-score)<1e-12 && (items.length<selected.length || (items.length===selected.length && ids<selected.map(s=>s.id).join("|"))))) {
        selected=[...items]; score=next;
      }
    }
    if(items.length===budget) return;
    for(let i=from;i<pool.length;i++) visit(i+1,[...items,pool[i]]);
  };
  visit(0,[]);
  return {selected, count};
}

/** Mission-aware experimental coverage. All Earth/control runs must hold engineering
 * and endpoints fixed; no synthetic site or environmental observation is introduced.
 */
export function buildTransfer(target: RunResult, runs: RunResult[], budget: number): TransferCampaign {
  if (target.scenario.mode!=="rover" || !target.scenario.rover.design || target.scenario.kind!=="native")
    throw new Error("Transfer analysis requires a native planetary engineering rover run.");
  if (!Number.isInteger(budget) || budget<1 || budget>3) throw new Error("Campaign budget must be 1–3 sites.");
  const signature = (r: RunResult) => {
    const {terrainId:_, environment:__, kind:___, solar:____, ...fixed} = r.scenario;
    return JSON.stringify(fixed);
  };
  if(runs.some(r=>r.model!==target.model || signature(r)!==signature(target))) throw new Error("Transfer runs must use identical mission and engineering inputs.");
  const terrain = terrainStatistics(target.terrain), r=target.scenario.rover;
  const slopes=values(target,"slope"),torques=values(target,"torque"),powers=values(target,"power");
  const effectiveLimit=Math.min(r.maxSlope,tipAngle(r.design!));
  const pool: TransferSite[]=[];
  for(const earth of runs.filter(r=>r.scenario.kind==="earth-analog")) {
    const control=runs.find(r=>r.scenario.kind==="counterfactual" && r.terrain.id===earth.terrain.id);
    if(!control || control.scenario.environment.planet!==target.scenario.environment.planet || control.terrain.source.sha256!==earth.terrain.source.sha256) throw new Error("Missing matched target-physics control.");
    if(earth.scenario.solar || control.scenario.solar) throw new Error("Transfer controls must exclude site-specific solar charging.");
    const stats=terrainStatistics(earth.terrain);
    const lower=.8*effectiveLimit,upper=1.2*effectiveLimit;
    // Histogram approximation is intentionally avoided: use actual per-cell gradients.
    const boundary=boundaryFraction(earth,effectiveLimit);
    const coverage={
      terrain:match(slopes,values(control,"slope"),Math.max(1,r.maxSlope*.2)),
      load:match(torques,values(earth,"torque"),Math.max(1,(quantile(torques,.9)??0)*.5)),
      power:match(powers,values(earth,"power"),Math.max(10,(quantile(powers,.9)??0)*.3)),
      boundary:Math.min(1,boundary/.1),
    };
    const notes=[`${(100*boundary).toFixed(1)}% of valid regional cells fall in the ${lower.toFixed(1)}–${upper.toFixed(1)}° boundary band. Wheel-scale hazards are unknown.`];
    const sameFinish=earth.outcome==="destination_reached" && control.outcome==="destination_reached" && JSON.stringify(earth.route)===JSON.stringify(control.route);
    if(!sameFinish) notes.push("Energy differences are not an isolated environment effect unless both runs finish the identical route.");
    if(!slopes.length) notes.push("The target route is blocked: route/torque/power coverage receives zero credit. Slope-boundary terrain remains an experimental opportunity.");
    notes.push("Earth gravity, atmosphere, regolith, geology and weather do not become equivalent through terrain similarity.");
    const site={id:earth.terrain.id,name:earth.terrain.name,lon:earth.terrain.lon,lat:earth.terrain.lat,
      coverage,score:campaignCoverage([{coverage} as TransferSite]).score,
      earthRunId:earth.id,controlRunId:control.id,earthOutcome:earth.outcome,controlOutcome:control.outcome,
      earthEnergyWh:earth.metrics.energyWh,controlEnergyWh:control.metrics.energyWh,
      energyEnvironmentDeltaWh:sameFinish?earth.metrics.energyWh-control.metrics.energyWh:null,
      geometryBaseline:Math.exp(-Math.abs((stats.p90Slope??0)-(terrain.p90Slope??0))/3-Math.abs((stats.relief??0)-(terrain.relief??0))/500),
      source:earth.terrain.source,notes};
    if(pool.some(p=>p.id===site.id)) throw new Error("Duplicate Earth site in transfer input.");
    pool.push(site);
  }
  if(pool.length>12) throw new Error("Exact transfer campaign search is bounded to 12 observed sites.");
  pool.sort((a,b)=>a.id.localeCompare(b.id));
  const exact=optimize(pool,budget),selected=exact.selected.map(s=>s.id);
  const geometry=[...pool].sort((a,b)=>b.geometryBaseline-a.geometryBaseline||a.id.localeCompare(b.id)).slice(0,budget);
  const single=[...pool].sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,budget);
  const greedy: TransferSite[]=[];
  for(let i=0;i<budget && i<pool.length;i++) {
    const next=pool.filter(s=>!greedy.includes(s)).sort((a,b)=>campaignCoverage([...greedy,b]).score-campaignCoverage([...greedy,a]).score||a.id.localeCompare(b.id))[0];
    greedy.push(next);
  }
  const baseline=(items:TransferSite[])=>({sites:items.map(s=>s.id),score:campaignCoverage(items).score});
  const peakTorque=quantile(torques,.9)??0, peakPower=quantile(powers,.9)??0;
  const measurements=[
    {name:"Drawbar pull and wheel torque",priority:1+peakTorque/r.design!.stallTorque,reason:`Target P90 wheel torque ${peakTorque.toFixed(2)} N m. Measure drawbar force, grade and normal load to constrain the assumed traction coefficient ${r.traction}.`},
    {name:"Rolling resistance and motor efficiency",priority:1+peakPower/Math.max(1,r.idlePower),reason:`Target P90 electrical load ${peakPower.toFixed(1)} W. Instrument wheel torque, speed and bus current; fit rolling resistance and drivetrain efficiency independently.`},
    {name:"Survey terrain below the DEM posting",priority:3,reason:`${target.terrain.grid.cell_m} m source reconstruction cannot resolve rocks, sinkage or local tip hazards. Acquire georeferenced centimetre-scale profiles before wheel-contact tests.`},
    {name:"Static tilt and mass properties",priority:1+(quantile(slopes,.9)??0)/Math.max(1,tipAngle(r.design!)),reason:`Measure centre of mass and loaded support polygon. Configured static threshold ${tipAngle(r.design!).toFixed(2)}°, with no dynamic rollover validation.`},
    {name:"Surface irradiance and panel output",priority:target.scenario.solar?2:0.5,reason:"Log irradiance, panel orientation, dust and electrical output. SPICE supplies geometry; surface transmission and thermal losses remain unmeasured."},
  ].sort((a,b)=>b.priority-a.priority||a.name.localeCompare(b.name));
  return {model:TRANSFER_MODEL,targetRunId:target.id,sites:pool,selected,...campaignCoverage(exact.selected),
    baselines:{geometry:baseline(geometry),single:baseline(single),greedy:baseline(greedy)},
    evaluatedCombinations:exact.count,budget,measurements,
    limitations:["Coverage scores are declared experimental relevance utilities, not mission-success probabilities or calibrated confidence.",
      "Exact optimum only over the supplied measured pilot windows and four declared objectives; no travel, cost, permits or accessibility model.",
      "Quantiles are sampled recorded states, not time-weighted or independently measured mechanical distributions.",
      "Measurement priority is an explicit stress/missing-evidence heuristic, not Bayesian expected information gain.",
      "Counterfactual runs substitute gravity and reference atmosphere, exclude solar charging, and are not physical Earth conditions.",
      "No equivalence of geology, regolith, atmosphere, radiation, temperature or field access is established."]};
}

import { cellPoint, slopeAt } from "./terrain.ts";
function boundaryFraction(run:RunResult,limit:number) {
  let valid=0,near=0;
  for(let i=0;i<run.terrain.grid.elevation_m.length;i++) {
    const slope=slopeAt(run.terrain,cellPoint(run.terrain,i));
    if(slope!==null){valid++;if(slope>=.8*limit && slope<=1.2*limit)near++;}
  }
  return valid?near/valid:0;
}

export function transferPlan(c: TransferCampaign, target: RunResult): string {
  return `# EGIZ Earth validation campaign\n\n${c.model} · ${target.model}\n\nTarget: ${target.terrain.name} · run ${target.id}\n\n## Mission inputs\n\n\`\`\`json\n${JSON.stringify(target.scenario,null,2)}\n\`\`\`\n\n## Exact campaign\n\nBudget ≤ ${c.budget}; ${c.evaluatedCombinations} subsets evaluated. Coverage utility ${c.score.toFixed(6)}.\n\n${c.selected.map(id=>{const s=c.sites.find(s=>s.id===id)!;return `### ${s.name}\n\n${s.lat}° N, ${s.lon}° E · ${s.earthOutcome} / target-physics ${s.controlOutcome}\n\nSource: ${s.source.url}\n\nRaster SHA-256: ${s.source.sha256}\n\n${s.notes.map(n=>`- ${n}`).join("\n")}`;}).join("\n\n")}\n\n## Measurement priorities\n\n${c.measurements.map(m=>`- [ ] ${m.name}: ${m.reason}`).join("\n")}\n\n## Objective definitions\n\n${OBJECTIVES.map(o=>`- ${o.label} (${o.weight}): ${o.definition}`).join("\n")}\n\n## Baselines\n\n${JSON.stringify(c.baselines,null,2)}\n\n## Scientific limits\n\n${c.limitations.map(l=>`- ${l}`).join("\n")}\n\n## Field procedure\n\n- [ ] Verify land access, permits and site conditions independently.\n- [ ] Survey a safe instrumented test area, do not treat regional mission coordinates as a field route.\n- [ ] Record calibration, units, instrument uncertainty, mass, software version and date.\n- [ ] Repeat tests, retain raw logs, fit parameters and rerun the same archived mission.\n- [ ] Record residuals and reject unsupported transfer assumptions.\n`;
}
