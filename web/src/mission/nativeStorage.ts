import { validateDynamics, type DynamicsRun } from './dynamics';
async function database():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const r=indexedDB.open('egiz-native-dynamics-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('runs',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('Native archive storage unavailable; export JSON to preserve results'));});}
export async function nativeRuns():Promise<{runs:DynamicsRun[];rejected:number}>{const db=await database();return new Promise((resolve,reject)=>{const r=db.transaction('runs','readonly').objectStore('runs').getAll();r.onsuccess=()=>{db.close();try{const valid:DynamicsRun[]=[];let rejected=0;for(const value of r.result){try{valid.push(validateDynamics(value));}catch{rejected++;}}resolve({runs:valid.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).slice(-12),rejected});}catch(e){reject(e);}};r.onerror=()=>{db.close();reject(Error('Could not read native experiment archive'));};});}
export async function archiveNative(run:DynamicsRun):Promise<void>{const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('runs','readwrite'),store=tx.objectStore('runs');store.put(run);const all=store.getAll();all.onsuccess=()=>{const records=(all.result as DynamicsRun[]).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));for(const old of records.slice(0,Math.max(0,records.length-12)))store.delete(old.id);};tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(Error('Native archive quota/storage failure; export this run'));};});}
export function compareNativeArchive(a:DynamicsRun,b:DynamicsRun){
  if(a.adapter!==b.adapter||a.engine!==b.engine||a.inputSha256!==b.inputSha256||a.modelSha256!==b.modelSha256||a.states.length!==b.states.length)throw Error('Engine version, inputs or native model changed');
  let maximum=0;
  function compare(x:unknown,y:unknown){
    if(typeof x==='number'&&typeof y==='number'){maximum=Math.max(maximum,Math.abs(x-y));if(Math.abs(x-y)>1e-8+Math.abs(x)*1e-11)throw Error('Archived numerical state differs from native re-execution');}
    else if(Array.isArray(x)&&Array.isArray(y)){if(x.length!==y.length)throw Error('Archive state shape changed');x.forEach((v,i)=>compare(v,y[i]));}
    else if(x&&y&&typeof x==='object'&&typeof y==='object'){const keys=Object.keys(x);if(JSON.stringify(keys.sort())!==JSON.stringify(Object.keys(y).sort()))throw Error('Archive state fields changed');for(const key of keys)compare((x as Record<string,unknown>)[key],(y as Record<string,unknown>)[key]);}
    else if(x!==y)throw Error('Archived event/state changed');
  }
  compare(a.states,b.states);compare(a.metrics,b.metrics);compare(a.geometry,b.geometry);compare(a.events,b.events);return maximum;
}
