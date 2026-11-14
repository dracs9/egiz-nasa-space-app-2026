// Independent Kepler solution for actual UI-executed Basilisk archives.
// Positive tangential impulses start at periapsis; no measured historical spacecraft claim.
import { readFile } from 'node:fs/promises';
const paths=process.argv.slice(2);
for(const file of paths.length?paths:['artifacts/equipment-lunar-orbit.json','artifacts/equipment-lunar-impulse.json']){
  const r=JSON.parse(await readFile(file,'utf8'));
  if(r.schema!=='egiz.dynamics_experiment'||r.request.kind!=='orbit'||!r.engine.startsWith('Basilisk ')||r.states.length!==901)throw Error(`Unexpected native record: ${file}`);
  const mu=r.metrics.mu,r0=r.metrics.radius+r.request.altitudeKm*1000,inc=r.request.inclinationDeg*Math.PI/180;
  const v0=Math.sqrt(mu/r0)+r.request.deltaV,a=1/(2/r0-v0*v0/mu),e=1-r0/a,n=Math.sqrt(mu/a**3);
  if(!(e>=-1e-12&&e<1))throw Error('Verification supports circular or positive-impulse bound orbits');
  let maxError=0;
  for(const s of r.states){
    const mean=n*s.t;let E=mean;
    for(let i=0;i<20;i++){const correction=(E-e*Math.sin(E)-mean)/(1-e*Math.cos(E));E-=correction;if(Math.abs(correction)<1e-14)break;}
    const x=a*(Math.cos(E)-e),planeY=a*Math.sqrt(1-e*e)*Math.sin(E),expected=[x,planeY*Math.cos(inc),planeY*Math.sin(inc)];
    maxError=Math.max(maxError,Math.hypot(...s.position.map((p,i)=>p-expected[i])));
  }
  if(maxError>.001)throw Error(`Basilisk / independent Kepler mismatch: ${maxError} m`);
  console.log(`${file}: ${r.engine}, ${r.states.length} states, impulse ${r.request.deltaV} m/s, max Kepler position error ${maxError.toExponential(6)} m, energy drift ${r.metrics.energyRelativeDrift.toExponential(3)}.`);
}
