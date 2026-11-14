import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import MissionLab from "./MissionLab";
import { simulate } from "./engine";
import { saveRun, savedRuns } from "./storage";
import { useAppStore } from "../state/store";
import { pilotTestData, testData } from "../data/testData";
import type { CampaignModel } from "../components/CampaignPage";
import type { MissionJob } from "../workers/mission.worker";
import terrain from "../../../data/pilot/mission_terrain.json";
import solarCatalog from "../../../data/pilot/spice_geometry.json";
import { GUIDE_SEEN_KEY } from "./MissionGuide";
vi.mock("./PlanetView", () => ({
  PlanetView: ({ onEnter }: { onEnter(): void }) => (
    <button onClick={onEnter}>Explore measured terrain</button>
  ),
}));
vi.mock("./VehicleSchematic", () => ({
  VehicleSchematic: () => <div>Vehicle schematic</div>,
}));
vi.mock("./TerrainViewer", () => ({
  TerrainViewer: () => <div data-testid="measured-scene">Measured scene</div>,
}));
vi.mock("./storage", async () => ({
  ...(await vi.importActual("./storage")),
  savedRuns: vi.fn(async () => []),
  saveRun: vi.fn(async () => {}),
  deleteRun: vi.fn(async () => {}),
}));
let root: Root | null = null;
const jobs: MissionJob[][] = [];
class WorkerMock {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage(message: { jobs: MissionJob[] }) {
    jobs.push(message.jobs);
    queueMicrotask(() =>
      this.onmessage?.({
        data: {
          runs: message.jobs.map((j) =>
            simulate(j.scenario, j.terrain, j.inputs),
          ),
        },
      }),
    );
  }
  terminate() {}
}
const model = {
  campaigns: [
    { k: 3, sites: [{ id: "PILOT_ICELAND" }, { id: "PILOT_WADI_RUM" }] },
  ],
} as CampaignModel;
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  jobs.length = 0;
  localStorage.removeItem(GUIDE_SEEN_KEY);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("Worker", WorkerMock);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => terrain })),
  );
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

it("offers first-visit guidance, remembers dismissal and lets returning visitors reopen it", async () => {
  await render();
  expect(document.querySelector(".ex-welcome")).not.toBeNull();
  await click("Explore freely");
  expect(localStorage.getItem(GUIDE_SEEN_KEY)).toBe("seen");
  await act(async () => root!.unmount());
  root = null;
  await render();
  expect(document.querySelector(".ex-welcome")).toBeNull();
  await click("Quick guide");
  expect(document.querySelector(".ex-guide h2")!.textContent).toBe(
    "Choose a world",
  );
  expect(document.activeElement).toBe(document.querySelector(".ex-guide h2"));
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>('[aria-label="Close guide"]')!
      .click(),
  );
  expect(document.querySelector(".ex-guide")).toBeNull();
  expect(document.activeElement).toBe(button("Quick guide"));
});

it("guides a real mission through terrain, calculation, replay and the recorded outcome", async () => {
  await render();
  await click("Start guide");
  expect(button("Replay").disabled).toBe(true);
  expect(button("Results").disabled).toBe(true);
  await click("Explore terrain");
  expect(document.querySelector(".ex-mission")!.getAttribute("data-view")).toBe(
    "region",
  );
  await click("Choose mission");
  expect(document.querySelector(".ex-mission")!.getAttribute("data-view")).toBe(
    "vehicle",
  );
  await click("Run mission");
  expect(jobs).toHaveLength(1);
  expect(document.querySelector(".ex-guide h2")!.textContent).toBe(
    "Replay your mission",
  );
  expect(document.querySelector('[aria-label="Pause replay"]')).not.toBeNull();
  await click("Back");
  await click("Watch replay");
  expect(jobs).toHaveLength(1);
  await click("View results");
  const result = simulate(
    jobs[0][0].scenario,
    jobs[0][0].terrain,
    jobs[0][0].inputs,
  );
  expect(document.querySelector(".ml-outcome")!.textContent).toContain(
    result.explanation,
  );
  expect(document.querySelector(".ml-outcome")!.textContent).toContain(
    result.outcome.replaceAll("_", " "),
  );
  expect(
    Number(
      document.querySelector<HTMLInputElement>(
        '[aria-label="Simulation timeline"]',
      )!.value,
    ),
  ).toBe(result.metrics.duration);
  await click("Finish guide");
  expect(document.querySelector(".ex-guide")).toBeNull();
  expect(document.querySelector(".ml-outcome")!.textContent).toContain(
    result.explanation,
  );
});

it("invalidates guided results when the mission changes and makes the next action clear", async () => {
  await render();
  await click("Start guide");
  await click("Mission");
  await click("Run mission");
  await click("Descent & landing");
  expect(document.querySelector(".ex-guide h2")!.textContent).toBe(
    "Run a mission",
  );
  expect(document.querySelector(".ex-guide")!.textContent).toContain(
    "See whether the lander",
  );
  expect(button("Results").disabled).toBe(true);
  await click("Run mission");
  expect(jobs.at(-1)![0].scenario.mode).toBe("descent");
  await click("View results");
  await click("Compare with Earth");
  expect(document.querySelector(".ex-guide")).toBeNull();
  expect(button("Run analog experiment")).toBeDefined();
});

it("blocks invalid guided runs without blocking navigation and remains on the run step after a worker error", async () => {
  await render();
  await click("Start guide");
  await change("Mass (kg)", "-1");
  expect(button("Explore terrain").disabled).toBe(false);
  await click("Mission");
  expect(button("Run mission").disabled).toBe(true);
  expect(document.querySelector(".ex-guide-hint")!.textContent).toContain(
    "Check Mission configuration:",
  );
  await change("Mass (kg)", "900");
  class FailingWorker extends WorkerMock {
    override postMessage() {
      queueMicrotask(() => this.onerror?.());
    }
  }
  vi.stubGlobal("Worker", FailingWorker);
  await click("Run mission");
  expect(document.querySelector('[role="alert"]')!.textContent).toContain(
    "Simulation worker failed",
  );
  expect(button("Run mission").disabled).toBe(false);
  expect(button("Results").disabled).toBe(true);
});

it("changes the guide's world using the real terrain and environmental state", async () => {
  await render();
  await click("Start guide");
  await click("Moon");
  expect(
    document.querySelector(".ex-guide-worlds [aria-pressed=true]")!.textContent,
  ).toBe("Moon");
  await click("Mission");
  await click("Run mission");
  expect(jobs[0][0].terrain.body).toBe("moon");
  expect(jobs[0][0].scenario.environment.planet).toBe("moon");
  await click("World");
  await click("Earth");
  expect(button("Results").disabled).toBe(true);
  expect(
    document.querySelector(".ex-guide-worlds [aria-pressed=true]")!.textContent,
  ).toBe("Earth");
});

it("keeps onboarding usable when browser preferences cannot be saved", async () => {
  const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Storage unavailable");
  });
  const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage unavailable");
  });
  try {
    await render();
    await click("Start guide");
    expect(document.querySelector(".ex-guide")).not.toBeNull();
    expect(document.querySelector(".ex-welcome")).toBeNull();
    await click("Quick guide");
    expect(document.querySelector(".ex-guide")).toBeNull();
  } finally {
    get.mockRestore();
    set.mockRestore();
  }
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
async function render(synthetic = false) {
  useAppStore.setState({
    data: synthetic ? testData : pilotTestData,
    dataMode: synthetic ? "demo" : "pilot",
    targetId: "MARS_JEZERO",
    k: 3,
  });
  document.body.innerHTML = '<div id="lab-test"></div>';
  root = createRoot(document.getElementById("lab-test")!);
  await act(async () => root!.render(<MissionLab model={model} />));
}
function button(text: string) {
  return Array.from(document.querySelectorAll("button")).find((b) =>
    (b.getAttribute("aria-label") ?? b.textContent)?.includes(text),
  )!;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
async function change(label: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(
    `[aria-label="${label}"]`,
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("runs a real-terrain mission, pauses and restarts replay, and saves the complete experiment", async () => {
  await render();
  expect(document.body.textContent).toContain("Planetary Mission Explorer");
  await click("START SIMULATION");
  expect(jobs).toHaveLength(1);
  expect(jobs[0][0].terrain.id).toBe("MARS_JEZERO");
  expect(document.querySelector('[aria-label="Pause replay"]')).not.toBeNull();
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>('[aria-label="Pause replay"]')!
      .click(),
  );
  expect(document.querySelector('[aria-label="Play replay"]')).not.toBeNull();
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>('[aria-label="Restart replay"]')!
      .click(),
  );
  expect(
    document.querySelector<HTMLInputElement>(
      '[aria-label="Simulation timeline"]',
    )!.value,
  ).toBe("0");
  await act(async () =>
    Array.from(document.querySelectorAll("button"))
      .find((b) => b.textContent === "Save")!
      .click(),
  );
  expect(saveRun).toHaveBeenCalledWith(
    expect.objectContaining({
      schema: "egiz.experiment",
      terrain: expect.objectContaining({ id: "MARS_JEZERO" }),
      frames: expect.any(Array),
    }),
  );
  await click("Scientific analysis");
  expect(document.body.textContent).toContain("destination reached");
  await click("JSON");
  const archive = document.querySelector<HTMLTextAreaElement>(
    '[aria-label="Complete experiment JSON"]',
  )!.value;
  expect(JSON.parse(archive)).toEqual(vi.mocked(saveRun).mock.calls.at(-1)![0]);
  await click("Close JSON export");
  expect(document.querySelector("dialog")).toBeNull();
});
it("creates an honest five-run analog batch using campaign candidates", async () => {
  await render();
  await click("Compare & sensitivity");
  await click("Run analog experiment");
  expect(jobs[0]).toHaveLength(5);
  expect(
    jobs[0].map((j) => [
      j.terrain.id,
      j.scenario.kind,
      j.scenario.environment.planet,
    ]),
  ).toEqual([
    ["MARS_JEZERO", "native", "mars"],
    ["PILOT_ICELAND", "earth-analog", "earth"],
    ["PILOT_ICELAND", "counterfactual", "mars"],
    ["PILOT_WADI_RUM", "earth-analog", "earth"],
    ["PILOT_WADI_RUM", "counterfactual", "mars"],
  ]);
  expect(document.querySelectorAll(".ml-table-wrap tbody tr")).toHaveLength(5);
  expect(document.body.textContent).toContain("not a success probability");
});
it("rejects invalid configuration before starting the worker", async () => {
  await render();
  await change("Mass (kg)", "-1");
  expect(button("START SIMULATION").disabled).toBe(true);
  expect(document.querySelector('[role="alert"]')!.textContent).toContain(
    "mass",
  );
  expect(jobs).toHaveLength(0);
});
it("edits launch throttle commands and sends them through the worker", async () => {
  await render();
  await click("Launch & flight");
  await click("Add throttle change");
  await change("Throttle time 2 (s)", "3.37");
  await change("Throttle 1 (%)", "75");
  await click("START SIMULATION");
  expect(jobs[0][0].scenario.thrustProgram).toEqual([
    { time: 0, throttle: 0.75 },
    { time: 3.37, throttle: 0 },
  ]);
  expect(document.querySelector('[aria-label="Pause replay"]')).not.toBeNull();
});
it("does not load measured terrain in synthetic mode", async () => {
  await render(true);
  expect(fetch).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain(
    "Mission Lab needs measured terrain",
  );
});
it("shows a recoverable error when measured terrain is unavailable", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockRejectedValueOnce(new Error("Offline missing terrain"))
      .mockResolvedValue({ ok: true, json: async () => terrain }),
  );
  await render();
  expect(document.body.textContent).toContain("Offline missing terrain");
  await click("Retry measured terrain");
  expect(document.body.textContent).toContain("START SIMULATION");
});

it("quick failure experiments change actual inputs and event jumps synchronize replay", async () => {
  await render();
  await click("Descent & landing");
  await click("Unpowered descent");
  await click("START SIMULATION");
  expect(jobs[0][0].scenario.vehicle.thrust).toBe(0);
  const end = simulate(jobs[0][0].scenario, jobs[0][0].terrain);
  const jump = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".ex-track-events button"),
  ).find((b) => b.getAttribute("aria-label")?.includes("hard landing"))!;
  await act(async () => jump.click());
  expect(
    Number(
      document.querySelector<HTMLInputElement>(
        '[aria-label="Simulation timeline"]',
      )!.value,
    ),
  ).toBeCloseTo(end.metrics.duration, 6);
  expect(
    document.querySelector('[aria-label="Replay experiment"]'),
  ).not.toBeNull();
  expect(document.querySelector(".ml-readouts")!.textContent).toContain(
    "100.2",
  );
});

it("opens a pair of calculated comparison scenes on a shared clock", async () => {
  await render();
  await click("Compare & sensitivity");
  await click("Run analog experiment");
  await click("Open 3D comparison");
  expect(
    document.querySelectorAll('[data-testid="measured-scene"]'),
  ).toHaveLength(2);
  expect(
    document.querySelector('[aria-label="Comparison timeline"]'),
  ).not.toBeNull();
  expect(
    document.querySelectorAll('[aria-label="Comparison experiment A"] option'),
  ).toHaveLength(5);
  await click("Close 3D comparison");
  expect(
    document.querySelectorAll('[data-testid="measured-scene"]'),
  ).toHaveLength(0);
  expect(button("Explore measured terrain")).toBeDefined();
});

it("keeps a zero-duration blocked route stopped instead of starting an endless replay clock", async () => {
  await render();
  await click("Slope challenge");
  await click("START SIMULATION");
  expect(
    document.querySelector<HTMLButtonElement>(
      '[aria-label="Replay experiment"]',
    )!.disabled,
  ).toBe(true);
  expect(
    document.querySelector<HTMLInputElement>(
      '[aria-label="Simulation timeline"]',
    )!.disabled,
  ).toBe(true);
  await click("Scientific analysis");
  expect(document.body.textContent).toContain("route blocked");
});

it("returns from an Earth analog to the already-selected planetary target", async () => {
  await render();
  await act(async () =>
    Array.from(document.querySelectorAll(".ex-worlds button"))
      .find((b) => b.textContent === "Earth")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
  expect(document.querySelector(".ex-region-summary")!.textContent).toContain(
    "S P Crater",
  );
  await act(async () =>
    Array.from(document.querySelectorAll(".ex-worlds button"))
      .find((b) => b.textContent === "Mars")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
  await click("START SIMULATION");
  expect(jobs.at(-1)![0].terrain.id).toBe("MARS_JEZERO");
  expect(jobs.at(-1)![0].scenario.environment.planet).toBe("mars");
});

it("restores flight playback speed when replaying an archive from a rover session", async () => {
  await render();
  await click("Descent & landing");
  await click("START SIMULATION");
  const job = jobs[0][0];
  const recorded = simulate(job.scenario, job.terrain, job.inputs);
  vi.mocked(savedRuns).mockResolvedValueOnce([recorded]);
  await act(async () =>
    Array.from(document.querySelectorAll("button"))
      .find((b) => b.textContent === "Save")!
      .click(),
  );
  await click("Rover traverse");
  expect(
    document.querySelector<HTMLSelectElement>('[aria-label="Replay speed"]')!
      .value,
  ).toBe("120");
  await click("Saved experiments");
  await act(async () =>
    Array.from(document.querySelectorAll("button"))
      .find((b) => b.textContent === "Replay")!
      .click(),
  );
  expect(
    document.querySelector<HTMLSelectElement>('[aria-label="Replay speed"]')!
      .value,
  ).toBe("5");
  expect(document.querySelector('[aria-label="Play replay"]')).not.toBeNull();
  expect(document.querySelector(".ml-readouts")!.textContent).toContain(
    "1,200",
  );
});

it("reaches the recorded terminal state despite native range decimal serialization", async () => {
  await render();
  await click("Descent & landing");
  await click("START SIMULATION");
  const job = jobs[0][0];
  const recorded = simulate(job.scenario, job.terrain, job.inputs);
  // Browsers can serialize the range maximum a few ulps below the original double.
  await change(
    "Simulation timeline",
    String(recorded.metrics.duration - 1e-12),
  );
  expect(
    document.querySelector('[aria-label="Replay experiment"]'),
  ).not.toBeNull();
  expect(
    document
      .querySelector('[aria-label="Next mission event"]')
      ?.hasAttribute("disabled"),
  ).toBe(true);
  expect(
    Number(
      document.querySelector<HTMLInputElement>(
        '[aria-label="Simulation timeline"]',
      )!.value,
    ),
  ).toBe(recorded.metrics.duration);
});

it("connects edited rover engineering, a nine-design sweep and measured Earth campaign execution",async()=>{
  await render();
  await click("ROVER ENGINEERING");
  await change("Wheel radius (m)","0.6");
  await click("Calculate this design");
  expect(jobs.at(-1)![0].scenario.rover.design!.wheelRadius).toBe(.6);
  expect(document.querySelector(".system-metric-grid")?.textContent).toContain("Wheel speed");
  await click("Rover engineering");
  await click("Run 9-design trade study");
  expect(jobs.at(-1)).toHaveLength(9);
  expect(new Set(jobs.at(-1)!.map(j=>j.scenario.rover.design!.stallTorque))).toEqual(new Set([20,60,120]));
  await click("Earth validation");
  await click("Build mission-aware campaign");
  expect(jobs.at(-1)).toHaveLength(17);
  expect(jobs.at(-1)!.every(j=>!j.scenario.solar)).toBe(true);
  expect(document.body.textContent).toContain("Mission-aware campaign coverage");
  expect(document.body.textContent).toContain("not mission-success probabilities");
  await click("Rover engineering");
  await change("Centre of mass height (m)","1.5");
  await click("Earth validation");
  expect(document.querySelector(".transfer-table")).toBeNull();
});

it("sends the explicitly entered UTC epoch rather than the initial datetime default",async()=>{
  await render();
  await click("ROVER ENGINEERING");
  await change("Mission epoch (UTC)","2026-11-14T14:00");
  vi.mocked(fetch).mockResolvedValueOnce({ok:false} as Response);
  await click("Execute NASA SPICE");
  const request=vi.mocked(fetch).mock.calls.at(-1)!;
  expect(JSON.parse((request[1] as RequestInit).body as string)).toMatchObject({siteId:"MARS_JEZERO",epochUtc:"2026-11-14T14:00:00.000Z"});
  expect(document.body.textContent).toContain("Start the optional Python SPICE service");
});

it("preserves engineering edits made while a scientific geometry request is in flight",async()=>{
  await render();await click("ROVER ENGINEERING");
  let complete!:(response:Response)=>void;
  vi.mocked(fetch).mockImplementationOnce(()=>new Promise<Response>(resolve=>{complete=resolve;}));
  await click("Execute NASA SPICE");
  await change("Vehicle mass (kg)","1300");
  const geometry=solarCatalog.entries.find(g=>g.siteId==="MARS_JEZERO")!;
  await act(async()=>complete({ok:true,json:async()=>geometry} as Response));
  await click("Calculate this design");
  expect(jobs.at(-1)![0].scenario.rover.mass).toBe(1300);
  expect(jobs.at(-1)![0].scenario.solar?.siteId).toBe("MARS_JEZERO");
});

it('retains a pinned calculation across design edits and evaluates the next run against explicit limits', async () => {
  await render(); await click('Explore freely');
  await click('START SIMULATION'); await click('Pause replay');
  await click('Pin as test baseline');
  const baselineId = document.querySelector('.bench-baseline-id')!.textContent;
  expect(document.querySelector('.sim-workbench')!.getAttribute('data-active-panel')).toBe('tests');
  await change('Energy ceiling', '0');
  expect(document.querySelector('.bench-gates [data-state="fail"]')!.textContent).toContain('Electrical energy');
  await click('Rover engineering'); await change('Vehicle mass (kg)', '1100');
  await click('Experiment test bench');
  expect(document.querySelector('.bench-baseline-id')!.textContent).toBe(baselineId);
  expect(document.querySelector('.bench-empty')).not.toBeNull();
  expect(document.querySelector<HTMLInputElement>('[aria-label="Energy ceiling"]')!.value).toBe('0');
  await click('Run configured experiment');
  expect(jobs.at(-1)![0].scenario.rover.mass).toBe(1100);
  expect(document.querySelector('.bench-deltas')).not.toBeNull();
  expect(document.querySelector('.bench-baseline')!.textContent).toContain('rover.mass');
  await click('Review test report JSON');
  const exported = JSON.parse(document.querySelector<HTMLTextAreaElement>('[aria-label="Test report JSON"]')!.value);
  expect(exported.schema).toBe('egiz.acceptance_report');
  expect(exported.current.scenario.rover.mass).toBe(1100);
  expect(exported.baseline.scenario.rover.mass).toBe(900);
  expect(exported.gates.find((g: { id: string }) => g.id === 'energy').status).toBe('fail');
  await click('Open synchronized comparison');
  expect(document.querySelector('.sim-workbench')!.getAttribute('data-active-panel')).toBe('compare');
  expect(document.querySelectorAll('.ml-table-wrap tbody tr')).toHaveLength(2);
  expect(document.querySelector('[aria-label="Comparison timeline"]')).not.toBeNull();
});

it('cancels a running worker, restores controls and rejects late worker publication', async () => {
  let hanging!: WorkerMock;
  const terminate = vi.fn();
  class HangingWorker extends WorkerMock {
    constructor() { super(); hanging = this; }
    override postMessage(message: { jobs: MissionJob[] }) { jobs.push(message.jobs); }
    override terminate = terminate;
  }
  vi.stubGlobal('Worker', HangingWorker);
  await render(); await click('Explore freely'); await click('START SIMULATION');
  expect(button('CALCULATING').disabled).toBe(true);
  await click('Cancel calculation');
  expect(terminate).toHaveBeenCalledOnce();
  expect(hanging.onmessage).toBeNull();
  expect(button('START SIMULATION').disabled).toBe(false);
  expect(document.querySelector<HTMLInputElement>('[aria-label="Simulation timeline"]')!.disabled).toBe(true);
  expect(document.body.textContent).toContain('No new record was created');
});

it('uses keyboard execution and replay shortcuts without intercepting editable fields', async () => {
  await render(); await click('Explore freely');
  const mass = document.querySelector<HTMLInputElement>('[aria-label="Mass (kg)"]')!;
  await act(async () => mass.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })));
  expect(jobs).toHaveLength(1);
  expect(document.querySelector('[aria-label="Pause replay"]')).not.toBeNull();
  await act(async () => mass.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })));
  expect(document.querySelector('[aria-label="Pause replay"]')).not.toBeNull();
  await act(async () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })));
  expect(document.querySelector('[aria-label="Play replay"]')).not.toBeNull();
});
