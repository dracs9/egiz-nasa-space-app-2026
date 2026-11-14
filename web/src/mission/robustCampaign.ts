import { campaignCoverage, type TransferCampaign } from './transfer.ts';
export interface RobustCampaign {
  schema:'egiz.robust_campaign';version:'1.0.0';selected:string[];worstScore:number;meanScore:number;
  nominalSelectionWorstScore:number;geometrySelectionWorstScore:number;regret:number;evaluatedSubsets:number;
  cases:{label:string;campaign:TransferCampaign}[];
  measurements:{parameter:string;impact:number;reason:string}[];interpretation:string;
}
/** Exact maximin over actual rerun campaigns, no invented uncertainty distribution. */
export function robustCampaign(cases:RobustCampaign['cases'],budget:number):RobustCampaign {
  if(!cases.length||cases.length>7||!Number.isInteger(budget)||budget<1||budget>3)throw Error('Robust search requires 1–7 cases and 1–3 sites');
  const ids=cases[0].campaign.sites.map(s=>s.id).sort();if(ids.length>12||!ids.length)throw Error('Robust search supports 1–12 sites');
  if(cases.some(c=>JSON.stringify(c.campaign.sites.map(s=>s.id).sort())!==JSON.stringify(ids)))throw Error('Robust cases must share measured sites');
  const scores=(selected:string[])=>cases.map(c=>campaignCoverage(c.campaign.sites.filter(s=>selected.includes(s.id))).score);
  let selected:string[]=[],worst=-1,mean=-1,count=0;
  const visit=(from:number,items:string[])=>{if(items.length){count++;const values=scores(items),w=Math.min(...values),m=values.reduce((a,b)=>a+b,0)/values.length;
    const tiedWorst = Math.abs(w-worst)<1e-12;
    const tiedMean = Math.abs(m-mean)<1e-12;
    const preferable = items.length<selected.length || (items.length===selected.length && items.join('|')<selected.join('|'));
    if(w>worst+1e-12 || (tiedWorst && (m>mean+1e-12 || (tiedMean && preferable)))) {
      selected=[...items];worst=w;mean=m;
    }
  }
    if(items.length===budget)return;for(let i=from;i<ids.length;i++)visit(i+1,[...items,ids[i]]);};visit(0,[]);
  const nominal=cases[0].campaign;
  const measurements=cases.slice(1).map(c=>{const score=campaignCoverage(c.campaign.sites.filter(s=>nominal.selected.includes(s.id))).score;return {parameter:c.label,impact:Math.abs(score-nominal.score),reason:`Nominal campaign coverage changes from ${nominal.score.toFixed(4)} to ${score.toFixed(4)} under this declared parameter stress. Measure the affected physical parameter before transferring this recommendation.`};}).sort((a,b)=>b.impact-a.impact);
  return {schema:'egiz.robust_campaign',version:'1.0.0',selected,worstScore:worst,meanScore:mean,
    nominalSelectionWorstScore:Math.min(...scores(nominal.selected)),geometrySelectionWorstScore:Math.min(...scores(nominal.baselines.geometry.sites)),
    regret:Math.max(...cases.map(c=>c.campaign.score-campaignCoverage(c.campaign.sites.filter(s=>selected.includes(s.id))).score)),evaluatedSubsets:count,cases:cases.map(({label,campaign})=>({label,campaign})),measurements,
    interpretation:'Finite deterministic assumption stress set. Maximize worst-case experimental coverage, then mean coverage. These user-declared intervals are not measured error bars, confidence intervals, expected information gain or mission-success probabilities.'};
}
