// EGIZ operating-mode search. Reuses the regional solver; hardware and task stay fixed.
import { simulate, validateScenario } from './engine.ts';
import { assessRun, requirementsValid, type TestGate, type TestRequirements } from './acceptance.ts';
import type { MissionTerrain, RunResult, Scenario } from './types.ts';

export interface SearchSpace { varySpeed: boolean; minSpeed: number; maxSpeed: number; samples: number; routes: Scenario['rover']['route'][] }
export interface EvaluatedOption { run: RunResult; gates: TestGate[]; feasible: boolean; margin: number | null; pareto: boolean }
export interface DesignStudy {
  schema: 'egiz.operating_study'; version: '1.0.0'; id: string; createdAt: string;
  requirements: TestRequirements; space: SearchSpace; baseline: EvaluatedOption; options: EvaluatedOption[];
  status: 'complete' | 'budget_exhausted'; planned: number; elapsedMs: number; budgetMs: number;
}
export function evaluateOption(run: RunResult, requirements: TestRequirements): EvaluatedOption {
  run = { ...run, requirements: { ...requirements } };
  const gates = assessRun(run, requirements);
  // Dimensionless supported resource slack; static margin is screened separately, not mixed with Wh/s.
  const margins = gates.filter(g => ['time','energy','reserve'].includes(g.id)).map(g =>
    typeof g.value === 'number' && g.limit !== null ?
      ((g.operator === '≥' ? g.value-g.limit : g.limit-g.value) / Math.max(1, Math.abs(g.limit))) : null);
  return { run, gates, feasible: gates.every(g => g.status === 'pass'), margin: margins.some(m => m === null) ? null : Math.min(...margins as number[]), pareto: false };
}
export function searchScenarios(s: Scenario, space: SearchSpace): Scenario[] {
  if (s.mode !== 'rover' || !s.rover.design) throw Error('Operating search requires the regional rover drivetrain model.');
  if (typeof space.varySpeed !== 'boolean' || Object.keys(space).some(k=>!['varySpeed','minSpeed','maxSpeed','samples','routes'].includes(k)) || !Number.isFinite(space.minSpeed) || !Number.isFinite(space.maxSpeed) || space.minSpeed < .01 || space.maxSpeed > 5 || space.minSpeed > space.maxSpeed || !Number.isInteger(space.samples) || space.samples < 2 || space.samples > 7 || !space.routes.length || space.routes.length > 3 || new Set(space.routes).size !== space.routes.length || space.routes.some(r => !['direct','astar','astar-energy'].includes(r))) throw Error('Invalid operating search bounds.');
  const speeds = space.varySpeed ? Array.from({length:space.samples}, (_,i)=>space.minSpeed+(space.maxSpeed-space.minSpeed)*i/(space.samples-1)) : [s.rover.speed];
  const unique = new Map<string, Scenario>();
  for (const speed of speeds) for (const route of space.routes) {
    const next = structuredClone(s); next.rover.speed = speed; next.rover.route = route;
    unique.set(JSON.stringify([speed,route]),next);
  }
  return [...unique.values()];
}
export function markPareto(options: EvaluatedOption[]) {
  const feasible = options.filter(o => o.feasible);
  for (const o of options) o.pareto = o.feasible && !feasible.some(b => b !== o &&
    b.run.metrics.energyWh <= o.run.metrics.energyWh + 1e-8 && b.run.metrics.duration <= o.run.metrics.duration + 1e-8 && (b.margin ?? -Infinity) >= (o.margin ?? -Infinity) - 1e-8 &&
    (b.run.metrics.energyWh < o.run.metrics.energyWh - 1e-8 || b.run.metrics.duration < o.run.metrics.duration - 1e-8 || (b.margin ?? -Infinity) > (o.margin ?? -Infinity) + 1e-8));
}
export function executeStudy(scenario: Scenario, terrain: MissionTerrain, inputs: Record<string,string>, requirements: TestRequirements, space: SearchSpace, budgetMs = 12000, progress: (done:number,total:number)=>void = ()=>{}): DesignStudy {
  if (!requirementsValid(requirements)) throw Error('Invalid acceptance requirements');
  if (!Number.isFinite(budgetMs) || budgetMs < 100 || budgetMs > 20000) throw Error('Invalid study compute budget.');
  const scenarios = searchScenarios(scenario,space), errors = validateScenario(scenario,terrain);
  if(errors.length) throw Error(errors.join(' '));
  if (Math.ceil(scenario.duration/scenario.dt)+terrain.grid.side**2+3>40000) throw Error('A study record exceeds the 40,000-state planning bound. Increase timestep.');
  if ((scenarios.length+1)*(Math.ceil(scenario.duration/scenario.dt)+terrain.grid.side*terrain.grid.side+3)>300000) throw Error('Study exceeds the 300,000-state planning bound. Reduce samples or increase timestep.');
  const start = performance.now();
  const baseline = evaluateOption(simulate(scenario,terrain,inputs),requirements), options: EvaluatedOption[] = [];
  for(const s of scenarios) {
    if(performance.now()-start >= budgetMs) break;
    options.push(evaluateOption(simulate(s,terrain,inputs),requirements)); progress(options.length,scenarios.length);
  }
  markPareto(options);
  return {schema:'egiz.operating_study',version:'1.0.0',id:crypto.randomUUID(),createdAt:new Date().toISOString(),requirements:{...requirements},space:structuredClone(space),baseline,options,status:options.length===scenarios.length?'complete':'budget_exhausted',planned:scenarios.length,elapsedMs:performance.now()-start,budgetMs};
}
export interface DecisionCell { rollingFactor: number; efficiencyFactor: number; winnerId: string | null; runs: EvaluatedOption[] }
export interface DecisionMap { schema:'egiz.decision_map'; version:'1.0.0'; studyId:string; candidateIds:string[]; cells:DecisionCell[]; elapsedMs:number; status:'complete'|'budget_exhausted' }
export function executeDecisionMap(study: DesignStudy, progress: (done:number,total:number)=>void = ()=>{}, budgetMs=12000): DecisionMap {
  // Bound actual runs by the measured nominal per-run cost and a hard two-choice, 18-run ceiling.
  const nominalCost=study.elapsedMs/Math.max(1,study.options.length+1);
  const candidates=study.options.filter(o=>o.feasible).sort((a,b)=>a.run.metrics.energyWh-b.run.metrics.energyWh);
  const first=candidates[0] ?? study.options[0] ?? study.baseline;
  const alternatives=candidates.filter(o=>o.run.scenario.rover.route!==first.run.scenario.rover.route || Math.abs(o.run.scenario.rover.speed-first.run.scenario.rover.speed)>.01).sort((a,b)=>a.run.metrics.duration-b.run.metrics.duration);
  const choices=[first,...(alternatives[0] && nominalCost*18<budgetMs*.8 && (Math.ceil(first.run.scenario.duration/first.run.scenario.dt)+first.run.terrain.grid.side**2+3)*18<300000 ? [alternatives[0]] : [])];
  const start=performance.now(),cells:DecisionCell[]=[];
  for(const rollingFactor of [.8,1,1.3]) for(const efficiencyFactor of [.85,1,1.05]) {
    if(performance.now()-start>=budgetMs) return {schema:'egiz.decision_map',version:'1.0.0',studyId:study.id,candidateIds:choices.map(o=>o.run.id),cells,elapsedMs:performance.now()-start,status:'budget_exhausted'};
    const runs=choices.map(o=>{
      const s=structuredClone(o.run.scenario);
      // Deliberate assumed stress cases, never an applied observation calibration.
      delete s.calibration;
      s.rover.rollingResistance*=rollingFactor; s.rover.efficiency=Math.min(1,s.rover.efficiency*efficiencyFactor);
      return evaluateOption(simulate(s,o.run.terrain,o.run.inputs),study.requirements);
    });
    const best=runs.map((r,i)=>({r,i})).filter(o=>o.r.feasible).sort((a,b)=>a.r.run.metrics.energyWh-b.r.run.metrics.energyWh || a.r.run.metrics.duration-b.r.run.metrics.duration)[0];
    cells.push({rollingFactor,efficiencyFactor,runs,winnerId:best ? choices[best.i].run.id : null}); progress(cells.length*choices.length,9*choices.length);
  }
  return {schema:'egiz.decision_map',version:'1.0.0',studyId:study.id,candidateIds:choices.map(o=>o.run.id),cells,elapsedMs:performance.now()-start,status:'complete'};
}
