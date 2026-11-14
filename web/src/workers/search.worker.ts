import { executeDecisionMap, executeStudy } from '../mission/search';
self.onmessage = event => {
  try {
    const progress=(done:number,total:number)=>self.postMessage({progress:{done,total}});
    const result=event.data.kind==='map' ? executeDecisionMap(event.data.study,progress) : executeStudy(event.data.scenario,event.data.terrain,event.data.inputs,event.data.requirements,event.data.space,12000,progress);
    self.postMessage({result});
  } catch(e) { self.postMessage({error:(e as Error).message}); }
};
