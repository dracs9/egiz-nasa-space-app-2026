import { describe,it,expect } from 'vitest';
import { robustCampaign } from './robustCampaign';
import type { TransferCampaign,TransferSite } from './transfer';
function campaign(scores:Record<string,number>,selected:string[]):TransferCampaign {
  const sites=Object.entries(scores).map(([id,value])=>({id,coverage:{terrain:value,load:value,power:value,boundary:value}} as TransferSite));
  return {sites,selected,score:Math.max(...selected.map(id=>scores[id])),baselines:{geometry:{sites:['A'],score:scores.A}}} as TransferCampaign;
}
describe('exact robust experiment selection',()=>{
 it('prefers stable complementary evidence to a fragile nominal winner',()=>{
   const cases=[{label:'nominal',campaign:campaign({A:.95,B:.75,C:.5},['A'])},{label:'friction stress',campaign:campaign({A:.1,B:.7,C:.6},['B'])}];
   const r=robustCampaign(cases,1);expect(r.selected).toEqual(['B']);expect(r.worstScore).toBeCloseTo(.7);expect(r.nominalSelectionWorstScore).toBeCloseTo(.1);expect(r.evaluatedSubsets).toBe(3);
 });
 it('searches all bounded subsets and has reproducible ties',()=>{
   const c=[{label:'same',campaign:campaign({A:.5,B:.5,C:.5},['A'])}];expect(robustCampaign(c,2).evaluatedSubsets).toBe(6);expect(robustCampaign(c,2).selected).toEqual(['A']);
 });
 it('rejects unmatched site pools and excessive budgets',()=>{
   expect(()=>robustCampaign([{label:'one',campaign:campaign({A:.5},['A'])},{label:'two',campaign:campaign({A:.5,B:.5},['A'])}],1)).toThrow('share');
   expect(()=>robustCampaign([],1)).toThrow();expect(()=>robustCampaign([{label:'one',campaign:campaign({A:.5},['A'])}],4)).toThrow();
 });
});
