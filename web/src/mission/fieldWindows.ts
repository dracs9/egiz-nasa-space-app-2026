import { tipAngle } from './mobility.ts';
import { cellPoint, slopeAt } from './terrain.ts';
import type { RunResult } from './types.ts';
export interface CandidateWindow { id:string; westM:number; eastM:number; southM:number; northM:number; support:number; match:number; slopeBandDeg:number[]; sourceSha256:string }
/** Enumerate non-overlapping 4 km windows inside an already measured pilot DSM.
 * Ranking is an instrumented-survey opportunity, never a verified/access-approved field site. */
export function candidateWindows(earth:RunResult,target:RunResult):CandidateWindow[] {
  if(earth.terrain.body!=='earth'||earth.scenario.kind!=='earth-analog')throw Error('Candidate windows require measured Earth terrain.');
  const t=earth.terrain,g=t.grid,stride=Math.max(2,Math.round(4000/g.cell_m)),windowResults:CandidateWindow[]=[];
  const moving=target.frames.filter(f=>f.speed>0).map(f=>f.slope).sort((a,b)=>a-b);
  const reference=moving.length?moving[Math.floor((moving.length-1)*.9)]:Math.min(target.scenario.rover.maxSlope,target.scenario.rover.design?tipAngle(target.scenario.rover.design):45);
  const low=Math.max(0,reference-2),high=reference+2;
  for(let row=0;row+stride<=g.side;row+=stride)for(let col=0;col+stride<=g.side;col+=stride){
    let valid=0,near=0;
    for(let y=row;y<row+stride;y++)for(let x=col;x<col+stride;x++){
      const slope=slopeAt(t,cellPoint(t,y*g.side+x));
      if(slope!==null){valid++;if(slope>=low&&slope<=high)near++;}
    }
    const support=valid/(stride*stride);
    if(support<.9)continue;
    const nw=cellPoint(t,row*g.side+col),se=cellPoint(t,(row+stride-1)*g.side+col+stride-1);
    windowResults.push({id:`${t.id}:r${row}:c${col}`,westM:nw.x-g.cell_m/2,eastM:se.x+g.cell_m/2,northM:nw.y+g.cell_m/2,southM:se.y-g.cell_m/2,support,match:near/valid,slopeBandDeg:[low,high],sourceSha256:t.source.sha256});
  }
  return windowResults.sort((a,b)=>b.match-a.match||a.id.localeCompare(b.id)).slice(0,3);
}
export function fieldTestContract(target:RunResult) {
  const power=Math.max(0,...target.frames.map(f=>f.mobility?.electricalPowerW??0));
  return [
    {test:'Electrical demand across a measured load range',unknown:'Drivetrain efficiency and idle bus demand',measurement:'Positive total shaft power from torque and speed, plus bus voltage/current; isolate solar input and record hardware/temperature.',conclusion:`Identify two electrical parameters within the measured load range. Mission peak bus demand is calculated, not a field reading.`,calculatedPeakPowerW:power,excluded:'No planetary thermal, dust, regolith, battery-ageing or radiation validation.'},
    {test:'Regional slope and traction boundary',unknown:'Sub-grid hazards, drawbar traction and rolling resistance',measurement:'Survey local topography; measure normal load, drawbar force, grade, speed and slip before a controlled Earth trial.',conclusion:'Constrain Earth test-surface parameters and decide which additional controlled load tests are needed.',excluded:'Earth soil does not become lunar or Martian regolith. Gravity and load transfer require separate treatment.'},
  ];
}
