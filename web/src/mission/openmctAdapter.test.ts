import { expect, it } from "vitest";
import { simulate } from "./engine";
import { defaultScenario } from "./environment";
import { CHANNELS, telemetryEpoch, telemetryRows } from "./openmctAdapter";
import type { MissionTerrain } from "./types";
import pilot from "../../../data/pilot/mission_terrain.json";

it("maps genuine solver values and units into Open MCT requests without future samples",()=>{
  const t=pilot.entries.find(t=>t.id==="MARS_JEZERO") as MissionTerrain;
  const run=simulate(defaultScenario(t),t),epoch=telemetryEpoch(run);
  for(const channel of CHANNELS) {
    const rows=telemetryRows(run,channel.key,100,epoch+20_000,epoch+80_000);
    expect(rows.every(r=>r.met>=20 && r.met<=80)).toBe(true);
    for(const row of rows) {
      const f=run.frames.find(f=>f.t===row.met)!;
      expect(row.value).toBe(channel.value(f));
      expect(row.utc).toBe(epoch+f.t*1000);
    }
  }
  expect(telemetryRows(run,"speed",10).length).toBeLessThan(telemetryRows(run,"speed",100).length);
  expect(telemetryRows(run,"speed",0)).toEqual([{utc:epoch,value:0,met:0}]);
  expect(()=>telemetryRows(run,"invented",100)).toThrow(/Unknown/);
});
