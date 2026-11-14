import { requirementsValid } from "./acceptance.ts";
import { MODEL } from "./environment.ts";
import { validateScenario } from "./engine.ts";
import { validateTerrain } from "./terrain.ts";
import type { RunResult, TerrainBundle } from "./types.ts";

const DATABASE = "egiz-mission-lab-v1";
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 2);
    let blocked = false;
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("runs")) request.result.createObjectStore("runs", { keyPath: "id" });
      if (!request.result.objectStoreNames.contains("studies")) request.result.createObjectStore("studies", { keyPath: "study.id" });
    };
    request.onblocked = () => { blocked = true; reject(new Error("Close other EGIZ tabs to upgrade local archive storage.")); };
    request.onsuccess = () => { if(blocked) request.result.close(); else resolve(request.result); };
    request.onerror = () =>
      reject(
        new Error(
          "Experiment storage is unavailable. Export JSON to preserve this run.",
        ),
      );
  });
}
export async function savedRuns(): Promise<RunResult[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db
      .transaction("runs", "readonly")
      .objectStore("runs")
      .getAll();
    request.onsuccess = () => {
      db.close();
      resolve(
        (request.result as RunResult[]).sort((a, b) =>
          b.createdAt.localeCompare(a.createdAt),
        ),
      );
    };
    request.onerror = () => {
      db.close();
      reject(new Error("Could not load saved experiments."));
    };
  });
}
export async function saveRun(run: RunResult): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("runs", "readwrite");
    tx.objectStore("runs").put(run);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(
        new Error(
          "Saving failed (storage permission or quota). Export JSON to preserve the run.",
        ),
      );
    };
  });
}
export async function deleteRun(id: string): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("runs", "readwrite");
    tx.objectStore("runs").delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(new Error("Could not delete the saved experiment."));
    };
  });
}
export function parseExperiment(text: string): RunResult {
  if (text.length > 40_000_000)
    throw new Error("Experiment exceeds the 40 MB import limit.");
  const run = JSON.parse(text) as RunResult;
  if (
    !run ||
    run.schema !== "egiz.experiment" ||
    run.version !== "1.0.0" ||
    (run.model !== MODEL && !(run.model === "egiz-local-mission-1.0.0" && !run.scenario?.rover?.design && !run.scenario?.solar)) ||
    typeof run.id !== "string" ||
    typeof run.createdAt !== "string" ||
    !Number.isFinite(Date.parse(run.createdAt)) ||
    !run.scenario ||
    !run.terrain ||
    !run.inputs ||
    !Array.isArray(run.frames) ||
    !run.frames.length ||
    run.frames.length > 120005
  )
    throw new Error("Unsupported or invalid experiment file.");
  validateTerrain(
    {
      schema: "egiz.mission_terrain",
      version: "1.0.0",
      synthetic: false,
      entries: [run.terrain],
      inputs: run.inputs,
    },
    run.inputs,
  );
  if (run.requirements !== undefined && !requirementsValid(run.requirements)) throw new Error("Invalid archived acceptance requirements.");
  const errors = validateScenario(run.scenario, run.terrain);
  if (errors.length) throw new Error(errors.join(" "));
  // Imported outputs are not trusted. The UI re-executes these embedded inputs.
  return run;
}
export function verifyImportedTerrain(
  run: RunResult,
  bundle: TerrainBundle,
): void {
  const known = bundle.entries.find((entry) => entry.id === run.terrain.id);
  // A claimed raw-source fingerprint does not authenticate an arbitrary uploaded
  // heightmap. Match the embedded reconstruction to the loaded measured bundle.
  const equal = (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b);
  if (
    !known ||
    !equal(run.inputs, bundle.inputs) ||
    !equal(run.terrain.grid, known.grid) ||
    !equal(run.terrain.source, known.source) ||
    run.terrain.body !== known.body ||
    run.terrain.lon !== known.lon ||
    run.terrain.lat !== known.lat ||
    run.terrain.local_crs !== known.local_crs ||
    run.terrain.name !== known.name ||
    run.terrain.source_pixel_m !== known.source_pixel_m ||
    !equal(run.terrain.local_origin, known.local_origin)
  ) {
    throw new Error(
      "The imported terrain does not match this verified dataset. Load the matching dataset version before reproducing it; arbitrary uploaded heights cannot be labeled measured terrain.",
    );
  }
}
export function report(run: RunResult): string {
  const s = run.scenario,
    m = run.metrics;
  return `# EGIZ Mission Lab experiment\n\nRun: ${run.id}\n\nGenerated: ${run.createdAt}\n\n## Experiment\n\n${s.mode} · ${s.kind} · ${run.terrain.name} (${run.terrain.body} terrain) · ${s.environment.planet} environment\n\nModel: ${run.model}\n\nIntegration: ${run.integrator}\n\nTimestep: ${s.dt} s; seed ${s.seed} (unused: deterministic).\n\n## Calculated outcome\n\n${run.outcome}: ${run.explanation}\n\n| Metric | Value |\n| --- | --- |\n| Elapsed | ${m.duration} s |\n| Peak AGL altitude | ${m.maxAltitude} m |\n| Peak speed | ${m.maxSpeed} m/s |\n| Peak dynamic pressure | ${m.maxQ} Pa |\n| Propellant used | ${m.fuelUsed} kg |\n| Distance | ${m.distance} m |\n| Energy proxy | ${m.energyWh} Wh |\n| Maximum sampled regional slope | ${m.maxSlope} deg |\n| Touchdown speed | ${m.touchdownSpeed ?? "No touchdown"} |\n\n## Fixed acceptance requirements\n\n${run.requirements ? JSON.stringify(run.requirements) : "Not recorded in this legacy experiment"}\n\n## Electrical calibration\n\n${run.scenario.calibration ? JSON.stringify(run.scenario.calibration) : "No observation calibration applied"}\n\n## Provenance\n\nTerrain: ${run.terrain.source.url}\n\nSource SHA-256: ${run.terrain.source.sha256}\n\nLocal CRS: ${run.terrain.local_crs}\n\nGrid: ${run.terrain.grid.cell_m} m; ${run.terrain.grid.side} × ${run.terrain.grid.side}. Native datum retained.\n\n${Object.entries(
    run.inputs,
  )
    .map(([key, value]) => `${key}: ${value}`)
    .join(
      "\n\n",
    )}\n\n## Events\n\n${run.events.map((e) => `- ${e.t.toFixed(3)} s · ${e.type}: ${e.detail}`).join("\n")}\n\n## Assumptions and limits\n\n${run.assumptions.map((a) => `- ${a}`).join("\n")}\n\n## Reproduction\n\nExport the companion JSON, which embeds the complete terrain, configuration, constants, telemetry and model metadata. Importing re-executes its inputs using this model version. The report alone is not the full experiment archive.\n\nIndependent, AI-assisted development on 18 October 2026. Human scientific validation pending. Not endorsed by NASA or ESA.\n`;
}


export interface EngineeringSession {
  schema:'egiz.engineering_session'; version:'1.0.0';
  study:import('./search').DesignStudy; map:import('./search').DecisionMap|null;
}
export async function savedEngineeringSessions():Promise<EngineeringSession[]> {
  const db=await database();
  return new Promise((resolve,reject)=>{
    const request=db.transaction('studies','readonly').objectStore('studies').getAll();
    request.onsuccess=()=>{db.close();resolve((request.result as EngineeringSession[]).filter(s=>s.schema==='egiz.engineering_session'&&s.version==='1.0.0'&&s.study?.schema==='egiz.operating_study').sort((a,b)=>b.study.createdAt.localeCompare(a.study.createdAt)));};
    request.onerror=()=>{db.close();reject(Error('Could not read saved engineering studies.'));};
  });
}
export async function saveEngineeringSession(session:EngineeringSession):Promise<void> {
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('studies','readwrite'),store=tx.objectStore('studies'),count=store.count(),existing=store.getKey(session.study.id);
    count.onsuccess=()=>{existing.onsuccess=()=>{if(count.result>=3&&existing.result===undefined){tx.abort();reject(Error('Local storage is limited to three complete studies. Export new studies as JSON to preserve existing records.'));return;}store.put(session);};};
    tx.oncomplete=()=>{db.close();resolve();};
    tx.onerror=tx.onabort=()=>{db.close();reject(Error('Complete study could not be saved. Storage quota or permission may be unavailable.'));};
  });
}
