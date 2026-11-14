import { describe, expect, it } from "vitest";
import { defaultScenario } from "./environment";
import { simulate, validateScenario } from "./engine";
import { drivetrain, tipAngle } from "./mobility";
import { solarAt, validateGeometry } from "./solar";
import { makeVehicle } from "./scene/vehicles";
import { replayFrame } from "./scene/replay";
import type { MissionTerrain, SpiceGeometry } from "./types";
import catalog from "../../../data/pilot/spice_geometry.json";
import pilot from "../../../data/pilot/mission_terrain.json";

// Analytical test geometry only; never shipped as an observation.
function plane(grade=0):MissionTerrain {
  return {id:"PLANE",name:"Synthetic analytical plane",body:"mars",lat:0,lon:0,
    source:{url:"https://example.org/test",sha256:"a".repeat(64),native_crs:"test"},local_crs:"test",local_origin:[0,0],source_pixel_m:200,
    grid:{side:11,cell_m:200,west_m:-1000,north_m:1000,valid_fraction:1,elevation_m:Array.from({length:121},(_,i)=>(i%11-5)*200*grade)}};
}
function scenario(t:MissionTerrain) {
  const s=defaultScenario(t);s.start={x:-500,y:0};s.destination={x:500,y:0};s.rover.route="direct";return s;
}
describe("engineering drivetrain and boundaries",()=>{
  it("matches analytic flat-ground force, torque, power and energy",()=>{
    const t=plane(),s=scenario(t),r=simulate(s,t),f=r.frames[1],force=s.rover.mass*3.71*s.rover.rollingResistance;
    expect(f.mobility!.wheelTorqueNm).toBeCloseTo(force*s.rover.design!.wheelRadius/6,10);
    expect(f.mobility!.motorRpm).toBeCloseTo(s.rover.speed/s.rover.design!.wheelRadius*60/(2*Math.PI),10);
    const power=force*s.rover.speed/s.rover.efficiency+s.rover.idlePower;
    expect(r.metrics.duration).toBeCloseTo(1000/s.rover.speed,7);
    expect(r.metrics.energyWh).toBeCloseTo(power*1000/s.rover.speed/3600,7);
    expect(r.frames.at(-1)!.mobility!.batteryRemainingWh).toBeCloseTo(s.rover.batteryWh-r.metrics.energyWh,7);
  });
  it("responds to mass, wheel radius, motor torque, power and static tip limits",()=>{
    const t=plane(.1),s=scenario(t),nominal=simulate(s,t);
    const weak=structuredClone(s);weak.rover.design!.stallTorque=1;
    expect(simulate(weak,t).outcome).toBe("engineering_limit");
    const slow=structuredClone(s);slow.rover.design!.motorPower=10;
    expect(simulate(slow,t).metrics.duration).toBeGreaterThan(nominal.metrics.duration);
    const heavy=structuredClone(s);heavy.rover.mass*=2;
    expect(simulate(heavy,t).metrics.energyWh).toBeGreaterThan(nominal.metrics.energyWh);
    const unstable=structuredClone(s);unstable.rover.design!.cgHeight=3;unstable.rover.design!.trackWidth=.6;
    expect(tipAngle(unstable.rover.design!)).toBeLessThan(6);
    const steep=plane(.2);expect(simulate(unstable,steep).outcome).toBe("route_blocked");
    const wheel=structuredClone(s);wheel.rover.design!.wheelRadius=.6;
    expect(drivetrain(wheel,.1,5).wheelTorqueNm).toBeGreaterThan(drivetrain(s,.1,5).wheelTorqueNm);
  });
  it("clips battery and duration exactly and replays recorded mobility",()=>{
    const t=plane(),s=scenario(t);s.rover.batteryWh=5;
    const run=simulate(s,t);expect(run.outcome).toBe("energy_limit");
    expect(run.metrics.energyWh).toBeCloseTo(5,9);
    expect(run.frames.at(-1)!.mobility!.batteryRemainingWh).toBe(0);
    expect(replayFrame(run,5).mobility!.wheelTorqueNm).toBeCloseTo(run.frames[1].mobility!.wheelTorqueNm);
    s.rover.batteryWh=3000;s.duration=12.37;
    expect(simulate(s,t).metrics.duration).toBeCloseTo(12.37,12);
  });
  it("uses real SPICE solar records for optional power and rejects mismatched sites",()=>{
    const t=pilot.entries.find(t=>t.id==="MARS_JEZERO") as MissionTerrain;
    const g=catalog.entries.find(g=>g.siteId===t.id) as SpiceGeometry;
    validateGeometry(g,t,18000);
    const s=defaultScenario(t),dark=simulate(s,t);
    s.solar=g;const sun=simulate(s,t);
    expect(sun.metrics.energyWh).toBeCloseTo(dark.metrics.energyWh,7);
    expect(sun.frames.at(-1)!.mobility!.generatedWh).toBeGreaterThan(0);
    expect(sun.frames.at(-1)!.mobility!.batteryRemainingWh).toBeGreaterThan(dark.frames.at(-1)!.mobility!.batteryRemainingWh);
    expect(Math.hypot(...solarAt(g,321).sunEnu)).toBeCloseTo(1,12);
    expect(()=>solarAt(g,86401)).toThrow(/outside/);
    expect(()=>validateGeometry(g,plane())).toThrow(/invalid/);
    s.solar={...g,samples:[{...g.samples[0],sunEnu:[NaN,0,0]},...g.samples.slice(1)]};
    expect(validateScenario(s,t).length).toBeGreaterThan(0);
  });
  it("renders configured dimensions in the actual six-wheel assembly",()=>{
    const s=scenario(plane()),d=s.rover.design!;d.trackWidth=3.4;d.wheelbase=3;d.wheelRadius=.6;
    const rig=makeVehicle("rover",d);
    expect(rig.wheels.map(w=>w.x)).toEqual([-1.7,-1.7,-1.7,1.7,1.7,1.7]);
    expect(rig.wheels[0].z).toBe(-1.5);
    expect(rig.wheels[0].spin.scale.y).toBeCloseTo(.6/.41);
    expect(rig.chassis!.name).toBe("chassis");
  });
});
