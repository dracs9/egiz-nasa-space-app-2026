import { describe, expect, it } from "vitest";
import { simulate } from "./engine";
import { defaultScenario, ENVIRONMENTS } from "./environment";
import { buildTransfer, campaignCoverage, transferPlan, OBJECTIVES } from "./transfer";
import { planRoute } from "./routing";
import { drivetrain } from "./mobility";
import { sampleTerrain } from "./terrain";
import type { MissionTerrain, Scenario } from "./types";
import pilot from "../../../data/pilot/mission_terrain.json";
import candidates from "../../../data/pilot/earth_candidates.json";

const target=pilot.entries.find(t=>t.id==="MARS_JEZERO") as MissionTerrain;
const earth=pilot.entries.filter(t=>t.body==="earth" && candidates.tiles.some(c=>c.id===t.id && c.pool!=="control" && (c.context.water_frac??1)<=.5)) as MissionTerrain[];
function experiment(s:Scenario=defaultScenario(target)) {
  const reference=simulate(s,target,pilot.inputs),runs=[reference];
  for(const t of earth) for(const kind of ["earth-analog","counterfactual"] as const)
    runs.push(simulate({...s,terrainId:t.id,kind,environment:{...ENVIRONMENTS[kind==="earth-analog"?"earth":"mars"]}},t,pilot.inputs));
  return {reference,runs};
}
describe("mission-aware experimental design",()=>{
  it("executes 17 measured runs and exact search beats the declared simpler baselines",()=>{
    const {reference,runs}=experiment(),c=buildTransfer(reference,runs,2);
    expect(runs).toHaveLength(17);expect(c.sites).toHaveLength(8);
    expect(c.evaluatedCombinations).toBe(36);
    expect(c.selected).toEqual(["PILOT_ICELAND","PILOT_WADI_RUM"]);
    for(const baseline of Object.values(c.baselines)) expect(c.score).toBeGreaterThanOrEqual(baseline.score-1e-12);
    let brute=0;
    for(const a of c.sites) for(const b of c.sites) brute=Math.max(brute,campaignCoverage(a===b?[a]:[a,b]).score);
    expect(c.score).toBeCloseTo(brute,14);
    expect(c.score).toBeCloseTo(.7021016025872794,10);
    for(const s of c.sites) for(const o of OBJECTIVES) expect(s.coverage[o.id]).toBeGreaterThanOrEqual(0);
    const blocked=c.sites.find(s=>s.id==="PILOT_WADI_RUM")!;
    expect(blocked.coverage.load).toBe(0);expect(blocked.coverage.boundary).toBe(1);
    expect(transferPlan(c,reference)).toContain(blocked.source.sha256);
    expect(transferPlan(c,reference)).toContain("not mission-success probabilities");
  });
  it("changes recommendations when mission constraints change and preserves missing evidence",()=>{
    const nominal=experiment(),s=defaultScenario(target);s.rover.maxSlope=1;
    const restricted=experiment(s),a=buildTransfer(nominal.reference,nominal.runs,2),b=buildTransfer(restricted.reference,restricted.runs,2);
    expect(b.selected).not.toEqual(a.selected);
    expect(restricted.reference.outcome).toBe("route_blocked");
    expect(b.sites.every(s=>s.coverage.load===0 && s.coverage.terrain===0)).toBe(true);
    expect(b.limitations.join(" ")).toContain("not Bayesian");
    expect(buildTransfer(nominal.reference,nominal.runs,3).score).toBeGreaterThanOrEqual(a.score);
  });
  it("rejects mismatched engineering inputs, missing controls and invalid budgets",()=>{
    const {reference,runs}=experiment();
    expect(()=>buildTransfer(reference,runs,0)).toThrow(/budget/);
    expect(()=>buildTransfer(reference,runs.slice(0,-1),2)).toThrow(/control/);
    const altered=structuredClone(runs);altered[1].scenario.rover.mass+=1;
    expect(()=>buildTransfer(reference,altered,2)).toThrow(/identical/);
  });
  it("minimum-energy routing never exceeds shortest-route gross energy on the same graph",()=>{
    const s=defaultScenario(target),shortest=planRoute(target,s);
    const energy=(path:typeof shortest)=>path.slice(1).reduce((sum,b,i)=>{
      const a=path[i],dz=sampleTerrain(target,b)!-sampleTerrain(target,a)!,horizontal=Math.hypot(b.x-a.x,b.y-a.y);
      const d=drivetrain(s,Math.atan2(dz,horizontal),0);
      return sum+d.electricalPowerW*Math.hypot(horizontal,dz)/d.speed/3600;
    },0);
    s.rover.route="astar-energy";const optimized=planRoute(target,s);
    expect(optimized.length).toBeGreaterThan(1);
    expect(energy(optimized)).toBeLessThanOrEqual(energy(shortest)+1e-8);
  });
});
