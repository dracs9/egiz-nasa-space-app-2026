import { simulate } from "../mission/engine";
import type { MissionTerrain, Scenario } from "../mission/types";
export interface MissionJob {
  scenario: Scenario;
  terrain: MissionTerrain;
  inputs: Record<string, string>;
}
self.onmessage = (event: MessageEvent<{ jobs: MissionJob[] }>) => {
  try {
    const runs = event.data.jobs.map((job) =>
      simulate(job.scenario, job.terrain, job.inputs),
    );
    self.postMessage({ runs });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
