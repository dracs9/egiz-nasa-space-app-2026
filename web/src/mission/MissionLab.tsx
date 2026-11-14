import { ContextHelp, DetailSection } from '../components/ContextHelp';
import { t as localizeText, useLanguage } from '../i18n';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ChartNoAxesCombined,
  Radio,
  Globe2,
  Wrench,
  Mountain,
  ChevronRight,
  Maximize2,
  ChevronDown,
  BookOpen,
  Boxes,
  ArrowRight,
  Compass,
  FlaskConical,
  FolderOpen,
  FileText,
  Gauge,
  GitCompareArrows,
  LoaderCircle,
  MapPin,
  Play,
  Pin,
  Plus,
  Save,
  Settings2,
  ShieldCheck,
  Trash2,
  Upload,
  ClipboardCheck,
  PanelLeftClose,
  PanelLeftOpen,
  Square,
  X,
} from "lucide-react";
import { useAppStore } from "../state/store";
import { hasSyntheticData } from "../data/load";
import { downloadJson, downloadText } from "../lib/download";
import type { CampaignModel } from "../components/CampaignPage";
import { defaultScenario, ENVIRONMENTS } from "./environment";
import { validateScenario } from "./engine";
import { replayFrame } from "./scene/replay";
import {
  crossSection,
  lineOfSight,
  sampleTerrain,
  validateTerrain,
} from "./terrain";
import {
  deleteRun,
  parseExperiment,
  verifyImportedTerrain,
  report,
  savedRuns,
  saveRun,
} from "./storage";
import { ComparisonReplay } from "./ComparisonReplay";
import { ComparisonEvidence } from "./ComparisonEvidence";
import { TerrainViewer } from "./TerrainViewer";
import { LaunchProgram } from "./LaunchProgram";
import { ExperimentExport } from "./ExperimentExport";
import type { MissionJob } from "../workers/mission.worker";
import type {
  MissionTerrain,
  Frame,
  Mode,
  Point,
  RunResult,
  Scenario,
  TerrainBundle,
} from "./types";
import "./mission.css";
import "./explorer.css";
import { PlanetView } from "./PlanetView";
import { MissionGlyph } from "./MissionGlyph";
import { VehicleSchematic } from "./VehicleSchematic";
import type { EquipmentId } from './modelCatalog';
import { DynamicsWorkbench } from "./DynamicsWorkbench";
import { RoverEngineering } from "./RoverEngineering";
import { ScienceGeometry } from "./ScienceGeometry";
import { TransferWorkspace } from "./TransferWorkspace";
import { MissionControl } from "./MissionControl";
import { verifyImportedGeometry } from "./solar";
import { OperatingSearch, type SearchRecord } from "./OperatingSearch";
import { ObservationWorkbench } from "./ObservationWorkbench";
import { ExperimentBench } from './ExperimentBench';
import { defaultRequirements, type TestRequirements } from './acceptance';
import "./engineering.css";
import "./workbench.css";
import "./observatory.css";
import "./lab-theme.css";
import { MissionTimeline, type ExplorerView } from "./MissionTimeline";
import type { CameraMode } from "./scene/runtime";
import {
  MissionGuide,
  MissionWelcome,
  useMissionGuide,
  type GuideStep,
} from "./MissionGuide";
import { takeLaunchIntent } from "./launchIntent";

const RESULT_TABS = [
['engineering','Design','Rover engineering',Wrench],['dynamics','Dynamics','Native engineering lab',Settings2],['tests','Tests','Experiment test bench',ClipboardCheck],['telemetry','Telemetry','Telemetry charts',ChartNoAxesCombined],['analysis','Analysis','Scientific analysis',FlaskConical],['validation','Earth tests','Earth validation',MapPin],['compare','Compare','Compare & sensitivity',GitCompareArrows],['control','Control','Mission Control',Radio],['experiments','Archive','Saved experiments',FolderOpen],
] as const;
type ResultTab = typeof RESULT_TABS[number][0];
type WorkPanel = 'world' | ResultTab;
const names: Record<Mode, string> = {
  rover: "Rover traverse",
  launch: "Launch & flight",
  descent: "Descent & landing",
  eva: "Habitat & EVA",
};
const display = (n: number | undefined, digits = 1) =>
  n === undefined || !Number.isFinite(n)
    ? "—"
    : n.toLocaleString("en-US", { maximumFractionDigits: digits });
const human = (text: string) => text.replaceAll("_", " ");
function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
  guideKey,
}: {
  label: string;
  guideKey?: string;
  value: number;
  onChange(n: number): void;
  step?: number;
  min?: number;
  max?: number;
}) {
  useLanguage();
  return (
    <label className="ml-field">
      <span>{localizeText(label)}</span>
      <input
        type="number"
        data-guide-field={guideKey}
        aria-label={localizeText(label)}
        value={Number.isFinite(value) ? value : ""}
        step={step}
        min={min}
        max={max}
        onChange={(e) =>
          onChange(e.target.value === "" ? NaN : Number(e.target.value))
        }
      />
    </label>
  );
}
function TelemetryChart({
  run,
  time,
  field,
  label,
  unit,
}: {
  run: RunResult;
  time: number;
  field: "altitude" | "speed" | "energyWh" | "dynamicPressure" | "battery" | "electricalPower" | "solarPower";
  label: string;
  unit: string;
}) {
  useLanguage();
  const value = (f:Frame) => field === "battery" ? f.mobility?.batteryRemainingWh??NaN : field === "electricalPower" ? f.mobility?.electricalPowerW??NaN : field === "solarPower" ? f.mobility?.solarPowerW??NaN : f[field];
  const { peak, end, points } = useMemo(() => {
    const frames = run.frames,
      peak = frames.reduce((max, f) => Number.isFinite(value(f)) ? Math.max(max, value(f)) : max, 1),
      end = frames.at(-1)!.t || 1;
    const step = Math.max(1, Math.floor(frames.length / 420));
    const points = frames
      .filter((_, i) => i % step === 0 || i === frames.length - 1)
      .map((f,i,subset) => Number.isFinite(value(f)) ? `${i===0||!Number.isFinite(value(subset[i-1]))?"M":"L"}${36 + (f.t / end) * 440},${113 - (value(f) / peak) * 84}` : "")
      .join(" ");
    return { peak, end, points };
  }, [run, field]);
  return (
    <div className="ml-chart">
      <div>
        <span>{localizeText(label)}</span>
        <b>
          {localizeText(display(value(replayFrame(run, time))))} <small>{localizeText(unit)}</small>
        </b>
      </div>
      <svg
        viewBox="0 0 490 140"
        role="img"
        aria-label={localizeText(`${label} versus time, peak ${display(peak)} ${unit}`)}
      >
        <path
          d="M36 29H476M36 71H476M36 113H476"
          stroke="#21313c"
          fill="none"
        />
        <text x="1" y="32">
          {localizeText(display(peak, 0))}
        </text>
        <text x="18" y="116">
          0
        </text>
        <text x="36" y="134">{localizeText("0 s")}</text>
        <text x="430" y="134">
          {localizeText(display(end, 0))}{localizeText(" s")}</text>
        <path
          d={points}
          fill="none"
          stroke="#71dec9"
          strokeWidth="1.8"
        />
        <line
          x1={36 + (Math.min(time, end) / end) * 440}
          x2={36 + (Math.min(time, end) / end) * 440}
          y1="21"
          y2="116"
          stroke="#eac08c"
          strokeDasharray="3 3"
        />
      </svg>
    </div>
  );
}
function Profile({
  terrain,
  from,
  to,
}: {
  terrain: MissionTerrain;
  from: Point;
  to: Point;
}) {
  useLanguage();
  const profile = crossSection(terrain, from, to),
    valid = profile.filter((p) => p.elevation !== null),
    low = Math.min(...valid.map((p) => p.elevation!)),
    high = Math.max(...valid.map((p) => p.elevation!));
  const distance = profile.at(-1)!.distance || 1;
  let path = "";
  let gap = true;
  for (const p of profile) {
    if (p.elevation === null) {
      gap = true;
      continue;
    }
    path += `${gap ? "M" : "L"}${10 + (p.distance / distance) * 460},${65 - ((p.elevation - low) / Math.max(1, high - low)) * 48} `;
    gap = false;
  }
  return (
    <div className="ml-profile">
      <div>
        <span>{localizeText("A → B · TERRAIN CROSS-SECTION")}</span>
        <b>{localizeText(display(distance / 1000, 2))}{localizeText(" km straight line")}</b>
      </div>
      <svg
        viewBox="0 0 480 78"
        role="img"
        aria-label={localizeText("Terrain cross-section between mission markers")}
      >
        <path d={path} stroke="#cbba9b" strokeWidth="1.5" fill="none" />
        <path d="M10 67H470" stroke="#30404b" />
      </svg>
      <p>{localizeText("Profile range ")}{localizeText(display(low, 0))}–{localizeText(display(high, 0))}{localizeText(" m · vertical axis rescaled · 200 m observations, interpolated between cells")}</p>
    </div>
  );
}
const ModelInspector = lazy(() => import('./ModelInspector'));

export default function MissionLab({ model }: { model: CampaignModel }) {
  useLanguage();
  const { data, dataMode, targetId, k, setTarget, navigate } = useAppStore();
  const [bundle, setBundle] = useState<TerrainBundle | null>(null),
    [loadError, setLoadError] = useState(""),
    [attempt, setAttempt] = useState(0);
  const [scenario, setScenario] = useState<Scenario | null>(null),
    [archivedTerrain, setArchivedTerrain] = useState<MissionTerrain | null>(
      null,
    );
  const [archivedInputs, setArchivedInputs] = useState<Record<
    string,
    string
  > | null>(null);
  const [run, setRun] = useState<RunResult | null>(null),
    [exportRun, setExportRun] = useState<RunResult | null>(null),
    [comparison, setComparison] = useState<RunResult[]>([]),
    [library, setLibrary] = useState<RunResult[]>([]);
  const [transferRuns, setTransferRuns] = useState<RunResult[]>([]),
    [exploded,setExploded] = useState(0);
  const [inspectorOpen,setInspectorOpen]=useState(false);
  const [activePanel, setActivePanel] = useState<WorkPanel>('world');
  const [setupOpen, setSetupOpen] = useState(true);
  const [nativeVisited, setNativeVisited] = useState(false);
  const [baseline, setBaseline] = useState<RunResult | null>(null);
  const [searchRecord, setSearchRecord] = useState<SearchRecord | null>(null);
  const [comparisonAutoOpen, setComparisonAutoOpen] = useState(false);
  const [requirements, setRequirements] = useState<TestRequirements | null>(null);
  useEffect(() => { if (activePanel === 'dynamics') setNativeVisited(true); }, [activePanel]);
  useEffect(() => { const panel = document.querySelector<HTMLElement>('.sim-workbench .ml-results'); if (panel) panel.scrollTop = 0; }, [activePanel]);
  const [inspectorModel,setInspectorModel]=useState<EquipmentId>();
  const openInspector=useCallback((id?:EquipmentId)=>{setInspectorModel(id);setInspectorOpen(true);},[]);
  const closeInspector=useCallback(()=>setInspectorOpen(false),[]);
  const [presentation, setPresentation] = useState("mission");
  const [explorerView, setExplorerView] = useState<ExplorerView>("planet");
  const [cameraBookmark, setCameraBookmark] = useState<{
    mode: CameraMode;
    revision: number;
  }>({ mode: "close", revision: 0 });
  const {
    welcome,
    step: guideStep,
    setStep: setGuideStep,
    dismissWelcome,
  } = useMissionGuide();
  const [snapshots, setSnapshots] = useState<
    Partial<Record<ExplorerView, string>>
  >({});
  useEffect(() => {
    setSnapshots({});
  }, [scenario?.terrainId, scenario?.mode, scenario?.rover.design]);
  const [viewHandoff, setViewHandoff] = useState(false);
  useEffect(() => {setViewHandoff(true);const timer=setTimeout(()=>setViewHandoff(false),1400);return ()=>clearTimeout(timer);},[explorerView]);
  const goView = (view: ExplorerView) => {
    setExplorerView(view);
    if (view === "scientific") setPresentation("scientific");
    else if (view !== "outcome") setPresentation("mission");
    const mode: CameraMode =
      view === "region" || view === "scientific"
        ? "orbit"
        : view === "follow"
          ? "follow"
          : "close";
    setCameraBookmark((previous) => ({
      mode,
      revision: previous.revision + 1,
    }));
    if (view === "outcome") {
      setTab("analysis");
      setPlaying(false);
      if (run) setTime(run.metrics.duration);
      document.querySelector(".ml-results")?.scrollIntoView({
        behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")
          .matches
          ? "instant"
          : "smooth",
      });
    }
  };
  const [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(60),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [tab, setResultTab] = useState<ResultTab>("telemetry"),
    [tool, setTool] = useState("inspect"),
    [observations, setObservations] = useState<Point[]>([]);
  const setTab = (next: ResultTab) => { setResultTab(next); setActivePanel(next); if (!['engineering','tests','telemetry','analysis'].includes(next)) setPlaying(false); };
  const worker = useRef<Worker | null>(null),
    cancelWorker = useRef<(() => void) | null>(null),
    mounted = useRef(true),
    fileInput = useRef<HTMLInputElement>(null);
  const synthetic = hasSyntheticData(data!);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelWorker.current?.();
      worker.current?.terminate();
    };
  }, []);
  useEffect(() => {
    savedRuns()
      .then(setLibrary)
      .catch(() =>
        setNotice(
          "Local storage is unavailable. JSON export remains available.",
        ),
      );
  }, []);
  useEffect(() => {
    if (synthetic) return;
    const controller = new AbortController();
    setBundle(null);
    setLoadError("");
    fetch(`${import.meta.env.BASE_URL}data/${dataMode}/mission_terrain.json`, {
      signal: controller.signal,
    })
      .then((r) => {
        if (!r.ok)
          throw new Error(
            "Measured Mission Lab terrain is not packaged for this dataset.",
          );
        return r.json();
      })
      .then((value) => {
        const validated = validateTerrain(value, data!.results.inputs);
        if (!controller.signal.aborted) setBundle(validated);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setLoadError(e.message);
      });
    return () => controller.abort();
  }, [dataMode, data, synthetic, attempt]);
  useEffect(() => {
    const terrain = bundle?.entries.find((e) => e.id === targetId);
    if (!terrain) return;
    cancelWorker.current?.();
    const intent = takeLaunchIntent() ?? undefined;
    setScenario(defaultScenario(terrain, intent));
    setRequirements(defaultRequirements(defaultScenario(terrain, intent)));
    setGuideStep((step) => (step === null ? null : 0));
    setExplorerView("planet");
    setRun(null);
    setArchivedTerrain(null);
    setArchivedInputs(null);
    setPlaying(false);
    setTime(0);
    setComparison([]);
    setComparisonAutoOpen(false);
    setTransferRuns([]);
    setObservations([]);
    setNotice("");
    setSpeed(intent === "launch" || intent === "descent" ? 5 : 120);
  }, [bundle, targetId]);
  useEffect(() => { if (scenario) setRequirements(defaultRequirements(scenario)); }, [scenario?.mode]);
  useEffect(() => {
    if (!playing || !run) return;
    let raf = 0,
      last = performance.now();
    const tick = (now: number) => {
      const dt = Math.max(0, Math.min((now - last) / 1000, 0.25));
      last = now;
      setTime((t) => Math.min(run.metrics.duration, t + dt * speed));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, run, speed]);
  useEffect(() => {
    if (run && time >= run.metrics.duration) setPlaying(false);
  }, [run, time]);
  const terrain =
    archivedTerrain ??
    bundle?.entries.find((t) => t.id === scenario?.terrainId);
  const surface = scenario?.mode === "rover" || scenario?.mode === "eva";
  const frame = run ? replayFrame(run, time) : null;
  const errors = useMemo(
    () => (scenario && terrain ? validateScenario(scenario, terrain) : []),
    [scenario, terrain],
  );
  const candidateIds =
    model.campaigns.find((c) => c.k === k)?.sites.map((s) => s.id) ?? [];
  const eligibleEarth =
    bundle?.entries.filter(
      (t) =>
        t.body === "earth" &&
        data!.candidates.tiles.some(
          (c) =>
            c.id === t.id &&
            c.pool !== "control" &&
            (c.context.water_frac ?? 1) <= 0.5,
        ),
    ) ?? [];
  const update = (next: Scenario) => {
    if(next.calibration && (next.kind!=="earth-analog" || next.mode!=="rover" || JSON.stringify(next.rover.design)!==JSON.stringify(next.calibration.hardware) || next.rover.efficiency!==next.calibration.efficiency || next.rover.idlePower!==next.calibration.idlePowerW)) delete next.calibration;
    if(next.solar && (next.solar.siteId!==next.terrainId || next.kind==="counterfactual")) delete next.solar;
    cancelWorker.current?.();
    setScenario(next);
    setTransferRuns([]);
    setComparison([]);
    setGuideStep((step) => (step !== null && step >= 3 ? 2 : step));
    if (explorerView === "outcome") goView("vehicle");
    setRun(null);
    setTime(0);
    setPlaying(false);
    setError("");
    setNotice("");
  };
  const chooseTerrain = (id: string) => {
    const selected = bundle?.entries.find((t) => t.id === id);
    if (!selected || !scenario) return;
    setArchivedTerrain(null);
    setArchivedInputs(null);
    setObservations([]);
    update({
      ...scenario,
      terrainId: id,
      kind: selected.body === "earth" ? "earth-analog" : "native",
      environment: { ...ENVIRONMENTS[selected.body] },
    });
  };
  const execute = async (jobs: MissionJob[]): Promise<RunResult[]> => {
    setBusy(true);
    setComparisonAutoOpen(false);
    setError("");
    setPlaying(false);
    try {
      return await new Promise((resolve, reject) => {
        cancelWorker.current?.();
        const w = new Worker(
          new URL("../workers/mission.worker.ts", import.meta.url),
          { type: "module" },
        );
        worker.current = w;
        let settled = false;
        const finish = (error?: Error, values?: RunResult[]) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          w.onmessage = null; w.onerror = null;
          w.terminate(); worker.current = null; cancelWorker.current = null;
          if (error) reject(error); else resolve(values!);
        };
        const timeout = window.setTimeout(() => {
          finish(
            new Error(
              "Experiment exceeded 45 seconds. Reduce duration or use a larger timestep.",
            ),
          );
        }, 45000);
        cancelWorker.current = () => finish(new DOMException('Simulation cancelled.', 'AbortError'));
        w.onmessage = (event) => {
          if (event.data.error) finish(new Error(event.data.error));
          else finish(undefined, event.data.runs);
        };
        w.onerror = () => {
          finish(
            new Error(
              "Simulation worker failed. Reload or check that worker assets are available offline.",
            ),
          );
        };
        w.postMessage({ jobs });
      });
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const present = (result: RunResult, autoplay = true) => {
    if (!result.requirements && requirements) result = { ...result, requirements: { ...requirements } };
    setRun(result);
    setTime(0);
    setPlaying(autoplay);
    setTab("telemetry");
  };
  const launch = async () => {
    if (!scenario || !terrain) return;
    try {
      setExploded(0);
      const [result] = await execute([
        { scenario, terrain, inputs: archivedInputs ?? bundle!.inputs },
      ]);
      present(result);
      setGuideStep((step) => (step === null ? null : 3));
      goView("follow");
      setNotice("");
    } catch (e) {
      if ((e as Error).name === 'AbortError') setNotice('Simulation cancelled. No new record was created.');
      else setError((e as Error).message);
    }
  };
  const openEngineering = () => {
    setTab("engineering"); setPlaying(false); goView("vehicle");
    document.querySelector(".ml-results")?.scrollIntoView({behavior:"smooth", block:"start"});
  };
  const tradeStudy = async () => {
    setTab("tests");
    setNotice("Search operating modes with fixed hardware, mission and acceptance requirements.");
  };
  const missionCampaign = async () => {
    if(!scenario || !bundle || !scenario.rover.design) return;
    const target=bundle.entries.find(t=>t.id===targetId);
    if(!target) return;
    try {
      const base=structuredClone(scenario);delete base.solar;delete base.calibration;
      const jobs:MissionJob[]=[{scenario:{...base,terrainId:target.id,kind:"native",environment:{...ENVIRONMENTS[target.body]}},terrain:target,inputs:bundle.inputs}];
      for(const earth of eligibleEarth) for(const kind of ["earth-analog","counterfactual"] as const)
        jobs.push({scenario:{...base,terrainId:earth.id,kind,environment:{...ENVIRONMENTS[kind==="earth-analog"?"earth":target.body]}},terrain:earth,inputs:bundle.inputs});
      setTransferRuns(await execute(jobs));setTab("validation");
    }catch(e){setError((e as Error).message);}
  };
  const batch = async (kind: "analogs" | "sensitivity") => {
    if (!scenario || !terrain || !bundle) return;
    try {
      const jobs: MissionJob[] = [];
      if (kind === "analogs") {
        const target = bundle.entries.find((t) => t.id === targetId)!;
        jobs.push({
          scenario: {
            ...scenario,
            solar: undefined,
            terrainId: target.id,
            kind: "native",
            environment: { ...ENVIRONMENTS[target.body] },
          },
          terrain: target,
          inputs: bundle.inputs,
        });
        const candidates = [...eligibleEarth]
          .sort(
            (a, b) =>
              Number(candidateIds.includes(b.id)) -
              Number(candidateIds.includes(a.id)),
          )
          .slice(0, 2);
        for (const site of candidates)
          for (const experiment of ["earth-analog", "counterfactual"] as const)
            jobs.push({
              scenario: {
                ...scenario,
                solar: undefined,
                terrainId: site.id,
                kind: experiment,
                environment: {
                  ...ENVIRONMENTS[
                    experiment === "earth-analog" ? "earth" : target.body
                  ],
                },
              },
              terrain: site,
              inputs: bundle.inputs,
            });
      } else {
        for (const factor of [0.8, 0.9, 1, 1.1, 1.2]) {
          const test = structuredClone(scenario);
          if (surface)
            test.rover.maxSlope = Math.min(
              45,
              scenario.rover.maxSlope * factor,
            );
          else if (scenario.mode === "descent")
            test.vehicle.initialVelocity =
              scenario.vehicle.initialVelocity * factor;
          else test.vehicle.thrust = scenario.vehicle.thrust * factor;
          jobs.push({
            scenario: test,
            terrain,
            inputs: archivedInputs ?? bundle.inputs,
          });
        }
      }
      const results = await execute(jobs);
      setComparison(results);
      setTab("compare");
      setNotice(
        kind === "analogs"
          ? "Matched local start/end coordinates and vehicle inputs. Each Earth terrain runs once with Earth physics, once with target physics. Site-specific measured weather is unavailable."
          : "Five deterministic perturbations (−20%, −10%, nominal, +10%, +20%). This is sensitivity, not a probability distribution.",
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const save = async (result: RunResult) => {
    try {
      await saveRun(result);
      setLibrary(await savedRuns());
      setNotice(
        "Experiment saved on this device, including terrain, scenario and all recorded states.",
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const replay = (result: RunResult) => {
    setArchivedTerrain(result.terrain);
    setArchivedInputs(result.inputs);
    setScenario(result.scenario);
    if(result.requirements) setRequirements(result.requirements);
    setSpeed(
      result.scenario.mode === "rover" || result.scenario.mode === "eva"
        ? 120
        : 5,
    );
    present(result, false);
    goView("vehicle");
    setNotice(
      "Replaying an archived experiment with its embedded terrain and original configuration.",
    );
  };
  const importFile = async (file: File) => {
    try {
      if (file.size > 40_000_000)
        throw new Error("Experiment exceeds the 40 MB import limit.");
      const parsed = parseExperiment(await file.text());
      if (!bundle)
        throw new Error("Load the measured terrain bundle before importing.");
      verifyImportedTerrain(parsed, bundle);
      if(parsed.scenario.solar) parsed.scenario.solar=await verifyImportedGeometry(parsed.scenario.solar,parsed.terrain);
      const [result] = await execute([
        {
          scenario: parsed.scenario,
          terrain: parsed.terrain,
          inputs: parsed.inputs,
        },
      ]);
      if(parsed.requirements) result.requirements = parsed.requirements;
      replay(result);
      setNotice(
        "Imported inputs re-executed. Displayed telemetry was recalculated, not trusted from the file.",
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const pick = (p: Point) => {
    if (!scenario || busy) return;
    if (tool === "start" || tool === "destination")
      update({
        ...scenario,
        [tool]: { x: Math.round(p.x), y: Math.round(p.y) },
      });
    if (tool === "observation") setObservations((points) => [...points, p]);
  };
  const scenePanel = ['world', 'engineering', 'tests', 'telemetry', 'analysis'].includes(activePanel);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !scenePanel || inspectorOpen || guideStep !== null || event.target instanceof Element && event.target.closest('dialog,[role="dialog"]')) return;
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !busy && errors.length === 0) { event.preventDefault(); void launch(); }
      if (event.target instanceof Element && event.target.closest('input,select,textarea,button,summary,[contenteditable="true"]')) return;
      if (event.code === 'Space' && !event.ctrlKey && !event.metaKey && !event.altKey && run?.metrics.duration) { event.preventDefault(); setExploded(0); if (time >= run.metrics.duration) setTime(0); setPlaying(p => !p); }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [scenePanel, inspectorOpen, guideStep, busy, scenario, terrain, run, time, errors.length]);
  if (synthetic)
    return (
      <main className="page ml-unavailable">
        <FlaskConical size={40} />
        <h1>{localizeText("Mission Lab needs measured terrain.")}</h1>
        <p>{localizeText("The synthetic campaign demo contains invented attributes. Select the measured terrain pilot to reconstruct real landscapes and run experiments.")}</p>
        <button
          className="primary-button"
          onClick={() => useAppStore.getState().setDataMode("pilot")}
        >{localizeText("Open measured terrain pilot ")}<ArrowRight size={16} />
        </button>
      </main>
    );
  if (loadError)
    return (
      <main className="page ml-unavailable">
        <h1>{localizeText("Mission terrain unavailable")}</h1>
        <p role="alert">{localizeText(loadError)}</p>
        <button
          className="primary-button"
          onClick={() => setAttempt((n) => n + 1)}
        >{localizeText("Retry measured terrain")}</button>
      </main>
    );
  if (!bundle || !scenario || !terrain)
    return (
      <main className="page ml-unavailable">
        <LoaderCircle className="loading-spinner" />
        <h1>{localizeText("Reconstructing the measured landscape…")}</h1>
        <p>{localizeText("Loading source-verified elevation samples.")}</p>
      </main>
    );
  const los = lineOfSight(terrain, scenario.start, scenario.destination);
  const vehicle = (key: keyof Scenario["vehicle"], value: number) =>
    update({ ...scenario, vehicle: { ...scenario.vehicle, [key]: value } });
  const rover = (key: keyof Scenario["rover"], value: number) =>
    update({ ...scenario, rover: { ...scenario.rover, [key]: value } });
  const env = (key: keyof Scenario["environment"], value: number) =>
    update({
      ...scenario,
      environment: { ...scenario.environment, [key]: value },
    });
  const completed = run && time >= run.metrics.duration;
  const telemetry: {
    label: string;
    value: number | undefined;
    unit: string;
    help: string;
  }[] = surface
    ? [
        {
          label: "Distance traveled",
          value: frame?.distance,
          unit: "m",
          help: "Distance covered, in meters.",
        },
        {
          label: "Ground speed",
          value: frame?.speed,
          unit: "m/s",
          help: "Speed over the ground, in meters per second.",
        },
        {
          label: "Estimated energy",
          value: frame?.energyWh,
          unit: "Wh",
          help: "Estimated energy used (Wh), not a certified battery prediction.",
        },
        {
          label: "Ground slope",
          value: frame?.slope,
          unit: "°",
          help: "Ground angle, in degrees. Small hazards are not resolved.",
        },
      ]
    : [
        {
          label: "Height above ground",
          value: frame?.altitude,
          unit: "m",
          help: "Height above ground (AGL), in meters.",
        },
        {
          label: "Speed",
          value: frame?.speed,
          unit: "m/s",
          help: "Speed, in meters per second.",
        },
        {
          label: "Net acceleration",
          value: frame?.acceleration,
          unit: "m/s²",
          help: "Acceleration from thrust, gravity and drag (m/s²).",
        },
        {
          label: "Propellant left",
          value: frame?.propellant,
          unit: "kg",
          help: "Engine propellant remaining, in kilograms.",
        },
        {
          label: "Dynamic pressure",
          value: frame?.dynamicPressure,
          unit: "Pa",
          help: "Airflow load, in pascals; zero in a vacuum.",
        },
        {
          label: "Engine thrust",
          value: frame?.thrust,
          unit: "N",
          help: "Engine force, in newtons.",
        },
      ];
  const chooseWorld = (body: "earth" | "moon" | "mars") => {
    const site =
      body === "earth"
        ? eligibleEarth[0]
        : bundle.entries.find((t) => t.body === body);
    if (!site) return;
    if (body !== "earth" && targetId !== site.id) setTarget(site.id);
    else chooseTerrain(site.id);
    setGuideStep((step) => (step === null ? null : 0));
    goView("planet");
  };
  const closeGuide = () => {
    setGuideStep(null);
    dismissWelcome();
    document
      .querySelector<HTMLButtonElement>(
        guideStep === 4
          ? '.sim-rail button[aria-pressed="true"]'
          : ".ex-guide-toggle",
      )
      ?.focus({ preventScroll: true });
  };
  const goGuide = (step: GuideStep) => {
    if (step >= 3 && !run) return;
    setGuideStep(step);
    if (step < 4) setActivePanel('world');
    if (step !== 3) setPlaying(false);
    else {
      if (completed) setTime(0);
      setPlaying(true);
    }
    goView(
      (["planet", "region", "vehicle", "follow", "outcome"] as const)[step],
    );
  };
  const guide =
    guideStep === null ? null : (
      <MissionGuide
        onInspect={() => openInspector()}
        step={guideStep}
        onGo={goGuide}
        onRun={() => void launch()}
        onClose={closeGuide}
        onCompare={() => {
          closeGuide();
          setTab("compare");
        }}
        onPlayback={() => {
          document
            .querySelector(".ex-timeline")
            ?.scrollIntoView({ block: "center", behavior: "instant" });
          document
            .querySelector<HTMLInputElement>(
              '#mission-replay-time',
            )
            ?.focus({ preventScroll: true });
        }}
        onWorld={chooseWorld}
        body={terrain.body}
        region={terrain.name.split(" / ")[0]}
        cellSize={terrain.grid.cell_m}
        mode={scenario.mode}
        run={run}
        busy={busy}
        validationError={errors[0]}
      />
    );
  return (
    <main
      className="ml-page ex-mission sim-workbench"
      data-active-panel={activePanel}
      data-setup-open={setupOpen}
      data-presentation={presentation}
      data-view={explorerView}
      data-guide-step={guideStep ?? undefined}
    >
      {inspectorOpen&&<Suspense fallback={null}><ModelInspector scenario={scenario} onClose={closeInspector} initialModel={inspectorModel}/></Suspense>}
      <header className="ml-intro ex-mission-header">
        <div className="ex-title">
          <h1>{localizeText("Planetary Mission Explorer")}</h1>
          <span className="sim-location">{localizeText(terrain.name.split(' / ')[0])}<ChevronRight size={12}/>{localizeText(activePanel === 'world' ? 'Simulation workspace' : RESULT_TABS.find(t => t[0] === activePanel)?.[2] ?? '')}</span>
        </div>
        <div className="ex-header-meta" hidden={!scenePanel}>
          <span>{localizeText("MISSION ")}<strong>{localizeText(names[scenario.mode])}</strong>
          </span>
          <span>{localizeText("ENVIRONMENT")}{localizeText(" ")}
            <strong>{localizeText(scenario.environment.planet.toUpperCase())}</strong>
          </span>
          <span>
            <i className={playing ? "ex-indicator live" : "ex-indicator"} />
            {localizeText(busy
              ? "CALCULATING"
              : playing
                ? "REPLAY ACTIVE"
                : run
                  ? "RECORD READY"
                  : "STANDBY")}
          </span>
        </div>
        <div className="ml-intro-actions">
          {scenePanel && <button aria-label={localizeText(setupOpen ? 'Hide mission inspector' : 'Show mission inspector')} title={localizeText(setupOpen ? 'Hide mission inspector' : 'Show mission inspector')} aria-pressed={setupOpen} onClick={() => {setSetupOpen(s=>!s); if(activePanel!=='world')setActivePanel('world');}}>{setupOpen ? <PanelLeftClose size={17}/> : <PanelLeftOpen size={17}/>}</button>}
          <ContextHelp label="Keyboard controls"><p><kbd>Ctrl / ⌘ + Enter</kbd> {localizeText('Calculate current setup')}</p><p><kbd>Space</kbd> {localizeText('Play / pause recorded time')}</p></ContextHelp>
          <button
            className="ex-guide-toggle"
            title={localizeText("Quick guide")} aria-label={localizeText("Quick guide")}
            aria-pressed={guideStep !== null}
            onClick={() => {
              if (guideStep !== null) closeGuide();
              else {
                dismissWelcome();
                goGuide(0);
              }
            }}
          >
            <BookOpen size={17} /><span className="sr-only">{localizeText(" Quick guide")}</span></button>
          <button className="ex-equipment-toggle" title={localizeText("Equipment studio")} aria-label={localizeText("Equipment studio")} onClick={()=>openInspector()}><Boxes size={18}/></button>
          <button
            onClick={() =>
              setPresentation((p) =>
                p === "cinematic" ? "mission" : "cinematic",
              )
            }
            aria-pressed={presentation === "cinematic"}
           title={localizeText("Focus view")} aria-label={localizeText("Focus view")}><Maximize2 size={17}/><span className="sr-only">{localizeText("Focus view")}</span></button>
          <button
            onClick={() => {
              setTab("experiments");
              document
                .querySelector(".ml-results")
                ?.scrollIntoView({ behavior: "smooth" });
            }}
            title={localizeText("Saved Mission Lab experiments")}
          >
            <FolderOpen size={14} />
            <span className="sr-only">{localizeText("Experiments ")}</span><b>{library.length}</b>
          </button>
        </div>
      </header>
      {localizeText(welcome && guideStep === null && (
        <MissionWelcome
          onStart={() => {
            dismissWelcome();
            goGuide(0);
          }}
          onDismiss={dismissWelcome}
        />
      ))}
      {localizeText(guideStep !== null && guideStep !== 4 && guide)}
      <div className="ml-modes" hidden={!scenePanel}>
        {localizeText((["rover", "launch", "descent", "eva"] as Mode[]).map((mode, i) => (
          <button
            key={mode}
            disabled={busy}
            aria-pressed={scenario.mode === mode}
            onClick={() => {
              const defaults = defaultScenario(terrain, mode);
              update({
                ...defaults,
                kind: scenario.kind,
                environment: scenario.environment,
              });
              setSpeed(mode === "rover" || mode === "eva" ? 120 : 5);
              if (explorerView !== "planet") goView("vehicle");
            }}
          >
            <span className="ml-mode-index">0{localizeText(i + 1)}</span>
            <MissionGlyph mode={mode} />
            <div>
              <strong>{localizeText(names[mode])}</strong>
              <small>
                {localizeText(mode === "rover"
                  ? "Drive across the terrain"
                  : mode === "launch"
                    ? "Test a rocket launch"
                    : mode === "descent"
                      ? "Try a surface landing"
                      : "Plan surface exploration")}
              </small>
            </div>
            <span className="ml-mode-dot" />
          </button>
        )))}
      </div>
      {localizeText(notice && (
        <div className="ml-notice" role="status">
          <ShieldCheck size={15} />
          {localizeText(notice)}
          <button
            aria-label={localizeText("Dismiss notification")}
            onClick={() => setNotice("")}
          >
            ×
          </button>
        </div>
      ))}
      {localizeText(error && (
        <div className="ml-error" role="alert">
          {localizeText(error)}
        </div>
      ))}
      <div className="sim-deck" data-scene-panel={scenePanel}>
        <nav className="sim-rail" aria-label={localizeText('Engineering workspaces')}>
          <button className="sim-world-button" aria-label={localizeText('Simulation workspace')} title={localizeText('Simulation workspace')} aria-pressed={activePanel === 'world'} onClick={() => setActivePanel('world')}><Globe2 size={20}/><span>{localizeText('World')}</span></button>
          {RESULT_TABS.map(([id, shortLabel, label, Icon]) => <button key={id} aria-label={localizeText(label)} title={localizeText(label)} aria-pressed={activePanel === id} onClick={() => {setTab(id); if(id==='engineering') {setPlaying(false);goView('vehicle');}}}><Icon size={19}/><span>{localizeText(shortLabel)}</span>{id === 'compare' && comparison.length > 0 && <b>{comparison.length}</b>}</button>)}
        </nav>
      <div className="ml-workspace" hidden={!scenePanel}>
        <aside className="ml-setup" hidden={!setupOpen || activePanel !== 'world'}>
          <div className="ml-panel-heading">
            <span>
              <Settings2 size={14} />{localizeText("MISSION SETUP")}</span>
            <span>01</span>
          </div>
          <div className="ex-worlds" aria-label={localizeText("Celestial body")}>
            {localizeText((["mars", "moon", "earth"] as const).map((body) => (
              <button
                key={body}
                aria-pressed={terrain.body === body}
                disabled={busy}
                onClick={() => chooseWorld(body)}
              >
                <span className={`ex-world-dot ${body}`} />
                {localizeText(body === "moon" ? "Moon" : body === "earth" ? "Earth" : "Mars")}
              </button>
            )))}
          </div>
          <div className="ex-region-summary">
            <span className="ex-overline">{localizeText("01 / RESEARCH TARGET")}</span>
            <h2>{localizeText(terrain.name.split(" / ")[0])}</h2>
            <p>
              {localizeText(Math.abs(terrain.lat).toFixed(4))}° {localizeText(terrain.lat < 0 ? "S" : "N")}{localizeText(" ")}
              <span>/</span> {localizeText(Math.abs(terrain.lon).toFixed(4))}°{localizeText(" ")}
              {localizeText(terrain.lon < 0 ? "W" : "E")}
            </p>
            <div className="terrain-resolution"><Mountain size={13}/>{terrain.grid.cell_m} m DEM</div>
          </div><button
            className="ml-start ex-primary-start"
            disabled={busy || errors.length > 0}
            onClick={launch}
          >
            {localizeText(busy ? (
              <LoaderCircle className="loading-spinner" size={14} />
            ) : (
              <Play size={12} fill="currentColor" />
            ))}
            {localizeText(busy ? "CALCULATING…" : "START SIMULATION")}
            <ArrowRight size={14} />
          </button>
          <VehicleSchematic scenario={scenario} onInspect={()=>openInspector()} />
          {localizeText(scenario.mode==="rover" && <button className="eng-launcher" onClick={openEngineering}>{localizeText("ROVER ENGINEERING ↗")}</button>)}

          <details className="ex-config-details">
            <summary>
              <Settings2 size={13} />{localizeText(" Mission configuration ")}<span>+</span>
            </summary>
            <fieldset disabled={busy}>
              <label className="ml-field">
                <span>{localizeText("Planetary research target")}</span>
                <select
                  aria-label={localizeText("Planetary research target")}
                  value={targetId}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  {localizeText(data!.targets.targets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {localizeText(t.name)}
                    </option>
                  )))}
                </select>
              </label>
              <label className="ml-field">
                <span>{localizeText("Reconstructed terrain")}</span>
                <select
                  aria-label={localizeText("Reconstructed terrain")}
                  value={scenario.terrainId}
                  onChange={(e) => chooseTerrain(e.target.value)}
                >
                  <optgroup label={localizeText("Planetary targets")}>
                    {localizeText(bundle.entries
                      .filter((t) => t.body !== "earth")
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {localizeText(t.name)}
                        </option>
                      )))}
                  </optgroup>
                  <optgroup label={localizeText("Measured Earth windows")}>
                    {localizeText(eligibleEarth.map((t) => (
                      <option key={t.id} value={t.id}>
                        {localizeText(candidateIds.includes(t.id) ? "★ " : "")}
                        {localizeText(t.name)}
                      </option>
                    )))}
                  </optgroup>
                </select>
              </label>
              <p className="ml-tiny">{localizeText("★ Selected by your current analog campaign. The water-dominated candidate is excluded.")}</p>
              <label className="ml-field">
                <span>{localizeText("Experiment interpretation")}</span>
                <select
                  aria-label={localizeText("Experiment interpretation")}
                  value={scenario.kind}
                  onChange={(e) =>
                    update({
                      ...scenario,
                      kind: e.target.value as Scenario["kind"],
                      environment: {
                        ...ENVIRONMENTS[
                          e.target.value === "counterfactual"
                            ? data!.targets.targets.find(
                                (t) => t.id === targetId,
                              )!.body
                            : terrain.body
                        ],
                      },
                    })
                  }
                >
                  {localizeText(terrain.body !== "earth" ? (
                    <option value="native">{localizeText("Planet-native simulation")}</option>
                  ) : (
                    <>
                      <option value="earth-analog">{localizeText("Physical Earth analog")}</option>
                      <option value="counterfactual">{localizeText("Controlled counterfactual")}</option>
                    </>
                  ))}
                </select>
              </label>
              <div
                className={`ml-interpretation ${scenario.kind === "counterfactual" ? "counterfactual" : ""}`}
              >
                <FlaskConical size={14} />
                <p>
                  {localizeText(scenario.kind === "native"
                    ? "Planetary terrain with its body’s reference environment."
                    : scenario.kind === "earth-analog"
                      ? "Earth terrain and Earth gravity. Atmosphere is a reference approximation, not measured site weather."
                      : "Earth terrain with deliberately substituted physics. This isolates modeled environmental effects; it does not describe real Earth conditions.")}
                </p>
              </div>
              {localizeText(scenario.kind === "counterfactual" && (
                <label className="ml-field">
                  <span>{localizeText("Substituted environment")}</span>
                  <select
                    aria-label={localizeText("Substituted environment")}
                    data-guide-field="planet"
                    value={scenario.environment.planet}
                    onChange={(e) =>
                      update({
                        ...scenario,
                        environment: {
                          ...ENVIRONMENTS[
                            e.target.value as keyof typeof ENVIRONMENTS
                          ],
                        },
                      })
                    }
                  >
                    {localizeText(["earth", "moon", "mars"].map((body) => (
                      <option key={body} value={body}>
                        {localizeText(body)}
                      </option>
                    )))}
                  </select>
                </label>
              ))}
              <div className="ml-test-scenarios">
                <span>{localizeText("QUICK EXPERIMENTS")}</span>
                <div>
                  {localizeText((surface
                    ? ["Regional traverse", "Slope challenge", "Energy limit"]
                    : scenario.mode === "launch"
                      ? ["Nominal ascent", "Delayed ignition", "No liftoff"]
                      : ["Guided descent", "Late ignition", "Unpowered descent"]
                  ).map((label) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => {
                        const next = defaultScenario(terrain, scenario.mode);
                        next.environment = scenario.environment;
                        next.kind = scenario.kind;
                        next.start = scenario.start;
                        next.destination = scenario.destination;
                        if (label === "Slope challenge")
                          next.rover.maxSlope = 1;
                        if (label === "Energy limit") next.rover.batteryWh = 5;
                        if (label === "Delayed ignition")
                          next.thrustProgram = [
                            { time: 0, throttle: 0 },
                            { time: 3, throttle: 1 },
                          ];
                        if (label === "No liftoff")
                          next.vehicle.thrust =
                            (next.vehicle.dryMass + next.vehicle.fuel) *
                            next.environment.gravity *
                            0.3;
                        if (label === "Late ignition")
                          next.vehicle.ignitionAltitude = 30;
                        if (label === "Unpowered descent")
                          next.vehicle.thrust = 0;
                        update(next);
                      }}
                    >
                      {localizeText(label)}
                    </button>
                  )))}
                </div>
                <small>{localizeText("Loads explicit inputs. Start to compute the outcome.")}</small>
              </div>
              <details className="ml-settings" open>
                <summary>
                  {localizeText(surface ? "Traverse configuration" : "Demonstration vehicle")}
                  <span>{localizeText("SI units")}</span>
                </summary>
                <div className="ml-field-grid">
                  {localizeText(surface ? (
                    <>
                      <NumberField
                        label={localizeText("Mass (kg)")}
                        guideKey="mass"
                        value={scenario.rover.mass}
                        onChange={(v) => rover("mass", v)}
                      />
                      <NumberField
                        label={localizeText("Cruise speed (m/s)")}
                        guideKey="speed"
                        value={scenario.rover.speed}
                        step={0.1}
                        onChange={(v) => rover("speed", v)}
                      />
                      <NumberField
                        label={localizeText("Slope limit (°)")}
                        guideKey="maxSlope"
                        value={scenario.rover.maxSlope}
                        onChange={(v) => rover("maxSlope", v)}
                      />
                      <NumberField
                        label={localizeText("Energy budget (Wh)")}
                        guideKey="batteryWh"
                        value={scenario.rover.batteryWh}
                        onChange={(v) => rover("batteryWh", v)}
                      />
                    </>
                  ) : (
                    <>
                      <NumberField
                        label={localizeText("Dry mass (kg)")}
                        guideKey="dryMass"
                        value={scenario.vehicle.dryMass}
                        onChange={(v) => vehicle("dryMass", v)}
                      />
                      <NumberField
                        label={localizeText("Propellant (kg)")}
                        guideKey="fuel"
                        value={scenario.vehicle.fuel}
                        onChange={(v) => vehicle("fuel", v)}
                      />
                      <NumberField
                        label={localizeText("Thrust (N)")}
                        guideKey="thrust"
                        value={scenario.vehicle.thrust}
                        step={1000}
                        onChange={(v) => vehicle("thrust", v)}
                      />
                      <NumberField
                        label={localizeText("Specific impulse (s)")}
                        guideKey="isp"
                        value={scenario.vehicle.isp}
                        onChange={(v) => vehicle("isp", v)}
                      />
                      {localizeText(scenario.mode === "descent" ? (
                        <>
                          <NumberField
                            label={localizeText("Initial altitude (m)")}
                            guideKey="initialAltitude"
                            value={scenario.vehicle.initialAltitude}
                            onChange={(v) => vehicle("initialAltitude", v)}
                          />
                          <NumberField
                            label={localizeText("Vertical speed (m/s)")}
                            guideKey="initialVelocity"
                            value={scenario.vehicle.initialVelocity}
                            onChange={(v) => vehicle("initialVelocity", v)}
                          />
                          <NumberField
                            label={localizeText("Ignition AGL (m)")}
                            guideKey="ignitionAltitude"
                            value={scenario.vehicle.ignitionAltitude}
                            onChange={(v) => vehicle("ignitionAltitude", v)}
                          />
                          <NumberField
                            label={localizeText("Touchdown limit (m/s)")}
                            guideKey="safeSpeed"
                            value={scenario.vehicle.safeSpeed}
                            onChange={(v) => vehicle("safeSpeed", v)}
                          />
                        </>
                      ) : (
                        <NumberField
                          label={localizeText("Tilt from vertical (°)")}
                          guideKey="angle"
                          value={scenario.vehicle.angle}
                          onChange={(v) => vehicle("angle", v)}
                        />
                      ))}
                    </>
                  ))}
                  <NumberField
                    label={localizeText("Duration (s)")}
                    guideKey="duration"
                    value={scenario.duration}
                    onChange={(v) => update({ ...scenario, duration: v })}
                  />
                  <NumberField
                    label={localizeText("Timestep (s)")}
                    guideKey="dt"
                    value={scenario.dt}
                    step={surface ? 1 : 0.05}
                    onChange={(v) => update({ ...scenario, dt: v })}
                  />
                </div>
                {localizeText(scenario.mode === "launch" && (
                  <LaunchProgram scenario={scenario} onChange={update} />
                ))}
                {localizeText(surface && (
                  <label className="ml-field">
                    <span>{localizeText("Route planner")}</span>
                    <select
                      aria-label={localizeText("Route planner")}
                      data-guide-field="route"
                      value={scenario.rover.route}
                      onChange={(e) =>
                        update({
                          ...scenario,
                          rover: {
                            ...scenario.rover,
                            route: e.target.value as Scenario["rover"]["route"],
                          },
                        })
                      }
                    >
                      <option value="astar">{localizeText("A* · shortest admissible path")}</option>
                      <option value="direct">{localizeText("Direct · test a straight traverse")}</option>
                      {localizeText(scenario.rover.design && <option value="astar-energy">{localizeText("Minimum gross electrical energy · Dijkstra")}</option>)}
                    </select>
                  </label>
                ))}
              </details>
              <details className="ml-settings">
                <summary>{localizeText("Environment & assumptions")}<span>{localizeText(scenario.environment.planet.toUpperCase())}</span>
                </summary>
                <div className="ml-field-grid">
                  <NumberField
                    label={localizeText("Gravity (m/s²)")}
                    guideKey="gravity"
                    value={scenario.environment.gravity}
                    step={0.01}
                    onChange={(v) => env("gravity", v)}
                  />
                  <NumberField
                    label={localizeText("Density (kg/m³)")}
                    guideKey="density"
                    value={scenario.environment.density}
                    step={0.01}
                    onChange={(v) => env("density", v)}
                  />
                  <NumberField
                    label={localizeText("Scale height (m)")}
                    guideKey="scaleHeight"
                    value={scenario.environment.scaleHeight}
                    onChange={(v) => env("scaleHeight", v)}
                  />
                </div>
                <ContextHelp label="Model & assumptions"><p className="ml-tiny">{localizeText("Reference ")}{localizeText(scenario.environment.pressureKpa)}{localizeText(" kPa ·")}{localizeText(" ")}
                  {localizeText(scenario.environment.temperatureK)}{localizeText(" K. Context only. Constant gravity and exponential density; no weather, wind or thermal coupling. Gravity changes require counterfactual mode.")}</p></ContextHelp>
                <div className="ml-field-grid">
                  {localizeText(surface ? (
                    <>
                      <NumberField
                        label={localizeText("Traction coefficient")}
                        guideKey="traction"
                        value={scenario.rover.traction}
                        step={0.05}
                        onChange={(v) => rover("traction", v)}
                      />
                      <NumberField
                        label={localizeText("Rolling resistance")}
                        guideKey="rollingResistance"
                        value={scenario.rover.rollingResistance}
                        step={0.01}
                        onChange={(v) => rover("rollingResistance", v)}
                      />
                      <NumberField
                        label={localizeText("Efficiency")}
                        guideKey="efficiency"
                        value={scenario.rover.efficiency}
                        step={0.05}
                        onChange={(v) => rover("efficiency", v)}
                      />
                      <NumberField
                        label={localizeText("Idle power (W)")}
                        guideKey="idlePower"
                        value={scenario.rover.idlePower}
                        onChange={(v) => rover("idlePower", v)}
                      />
                    </>
                  ) : (
                    <>
                      <NumberField
                        label={localizeText("Reference area (m²)")}
                        guideKey="area"
                        value={scenario.vehicle.area}
                        step={0.1}
                        onChange={(v) => vehicle("area", v)}
                      />
                      <NumberField
                        label={localizeText("Drag coefficient")}
                        guideKey="cd"
                        value={scenario.vehicle.cd}
                        step={0.1}
                        onChange={(v) => vehicle("cd", v)}
                      />
                      <NumberField
                        label={localizeText("Landing slope limit (°)")}
                        guideKey="safeSlope"
                        value={scenario.vehicle.safeSlope}
                        onChange={(v) => vehicle("safeSlope", v)}
                      />
                    </>
                  ))}
                </div>
              </details>
              <details className="ml-settings">
                <summary>{localizeText("Mission coordinates")}<span>{localizeText("local m")}</span>
                </summary>
                <div className="ml-field-grid">
                  {localizeText((["start", "destination"] as const).flatMap((which) =>
                    (["x", "y"] as const).map((axis) => (
                      <NumberField
                        key={which + axis}
                        label={localizeText(`${which === "start" ? "A" : "B"} ${axis === "x" ? "east" : "north"} (m)`)}
                        guideKey="coordinates"
                        value={scenario[which][axis]}
                        onChange={(v) =>
                          update({
                            ...scenario,
                            [which]: { ...scenario[which], [axis]: v },
                          })
                        }
                      />
                    )),
                  ))}
                </div>
                <ContextHelp label="Model & assumptions"><p className="ml-tiny">{localizeText("Local coordinates use the source’s metric projection. A is")}{localizeText(" ")}
                  {localizeText(scenario.mode === "eva"
                    ? "habitat / EVA origin"
                    : "mission start")}{localizeText("; B is the surface destination.")}</p></ContextHelp>
              </details>
            </fieldset>
            {localizeText(errors.length > 0 && (
              <div className="ml-error" role="alert">
                {localizeText(errors.map((e) => (
                  <p key={e}>{localizeText(e)}</p>
                )))}
              </div>
            ))}
            <button
              className="ml-start"
              disabled={busy || errors.length > 0}
              onClick={launch}
            >
              {localizeText(busy ? (
                <LoaderCircle className="loading-spinner" size={16} />
              ) : (
                <Play size={15} fill="currentColor" />
              ))}
              {localizeText(busy ? "CALCULATING…" : "CALCULATE WITH THESE INPUTS")}
              <ArrowRight size={16} />
            </button>
            <p className="ml-tiny ml-start-note">{localizeText("Calculated in a worker · deterministic stepping · offline capable")}</p>
          </details>
        </aside>
        <div className="ml-main-scene">
          {localizeText(explorerView === "planet" ? (
            <PlanetView
              terrain={terrain}
              solar={scenario.solar}
              time={time}
              onEnter={() => goView("region")}
              onCapture={(image) =>
                setSnapshots((p) => ({ ...p, planet: image }))
              }
            />
          ) : (
            <>
              <div className="ex-local-navigation">
                <button onClick={() => goView("planet")}>{localizeText("← Planetary overview")}</button>
                <span>{localizeText("LOCAL EAST / NORTH · SOURCE DATUM")}</span>
              </div>
              <div className="ml-tools">
                <span>{localizeText("MISSION MARKERS")}</span>
                {localizeText(["inspect", "start", "destination", "observation"].map((t) => (
                  <button
                    key={t}
                    disabled={busy}
                    aria-pressed={tool === t}
                    onClick={() => setTool(t)}
                  >
                    {localizeText(t === "inspect" ? (
                      <Compass size={12} />
                    ) : (
                      <MapPin size={12} />
                    ))}{localizeText(" ")}
                    {localizeText(t === "start"
                      ? scenario.mode === "eva"
                        ? "Place habitat"
                        : "Place start"
                      : t === "destination"
                        ? "Place destination"
                        : t === "observation"
                          ? "Add observation"
                          : "Inspect")}
                  </button>
                )))}
              </div>
              <TerrainViewer
                exploded={exploded}
                onCapture={(mode, image) => {
                  const key: ExplorerView =
                    mode === "orbit"
                      ? "region"
                      : mode === "follow"
                        ? "follow"
                        : "vehicle";
                  setSnapshots((p) => ({
                    ...p,
                    [key]: image,
                    ...(explorerView === "scientific"
                      ? { scientific: image }
                      : {}),
                  }));
                }}
                cameraBookmark={cameraBookmark}
                terrain={terrain}
                scenario={scenario}
                presentation={presentation}
                frame={frame}
                run={run}
                start={scenario.start}
                destination={scenario.destination}
                observations={observations}
                onPick={pick}
                tool={tool}
              />
            </>
          ))}
          {explorerView === "scientific" && <Profile
            terrain={terrain}
            from={scenario.start}
            to={scenario.destination}
          />}
        </div>
        <aside className="ml-telemetry" hidden={activePanel !== 'world'}>
          <div className="ml-panel-heading">
            <span>
              <Gauge size={14} />{localizeText("LIVE READINGS")}</span>
            <i className={playing ? "active" : ""} />
          </div>

          <div className="ml-readouts">
            {localizeText(telemetry.map((t) => (
              <div key={t.label} title={localizeText(t.help)}>
                <span>{localizeText(({"Distance traveled":"Distance","Ground speed":"Speed","Estimated energy":"Energy","Ground slope":"Slope","Height above ground":"Altitude","Net acceleration":"Acceleration","Propellant left":"Propellant","Engine thrust":"Thrust"} as Record<string,string>)[t.label]??t.label)}</span>
                <strong>
                  {localizeText(display(t.value))}
                  <small>{localizeText(t.unit)}</small>
                </strong>
              </div>
            )))}
          </div>
          <details className="ex-reading-definitions">
            <summary>{localizeText("About these readings")}</summary>
            <dl>
              {localizeText(telemetry.map((t) => (
                <div key={t.label}>
                  <dt>{localizeText(t.label)}</dt>
                  <dd>{localizeText(t.help)}</dd>
                </div>
              )))}
            </dl>
          </details>
          <DetailSection label="Environment" icon={Globe2}><div className="ml-environment-readout">
            <span>{localizeText("04 / ENVIRONMENT / ")}{localizeText(scenario.environment.planet.toUpperCase())}
            </span>
            <div>
              <b>
                <span className="ex-env-label">{localizeText("Gravity")}</span>
                {localizeText(display(scenario.environment.gravity, 2))} <small>{localizeText("m/s²")}</small>
              </b>
              <b>
                <span className="ex-env-label">{localizeText("Air density")}</span>
                {localizeText(scenario.environment.density)} <small>{localizeText("kg/m³")}</small>
              </b>
            </div>
            <dl className="ex-env-details">
              <div>
                <dt>{localizeText("Pressure")}</dt>
                <dd>{localizeText(scenario.environment.pressureKpa)}{localizeText(" kPa")}</dd>
              </div>
              <div>
                <dt>{localizeText("Temperature")}</dt>
                <dd>{localizeText(scenario.environment.temperatureK)}{localizeText(" K")}</dd>
              </div>
              <div>
                <dt>{localizeText("Terrain sampling")}</dt>
                <dd>{localizeText(terrain.grid.cell_m)}{localizeText(" m")}</dd>
              </div>
            </dl>
            <p>{localizeText("Reference assumptions ·")}{localizeText(" ")}
              {localizeText(scenario.kind === "counterfactual"
                ? "substituted on Earth terrain"
                : "body-specific model")}
            </p>
          </div></DetailSection>
          <div className="ex-mission-progress">
            <span>{localizeText("MISSION PROGRESS")}{localizeText(" ")}
              <b>
                {localizeText(run
                  ? Math.round((time / Math.max(1, run.metrics.duration)) * 100)
                  : 0)}
                %
              </b>
            </span>
            <div>
              <i
                style={{
                  width: `${run ? (time / Math.max(1, run.metrics.duration)) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
          {localizeText(frame?.mobility && <DetailSection label="Rover systems" icon={Gauge}><dl className="system-metric-grid">{([
["Wheel speed",frame.mobility.motorRpm,"rpm"],["Torque",frame.mobility.wheelTorqueNm,"N m"],["Bus load",frame.mobility.electricalPowerW,"W"],["Solar",frame.mobility.solarPowerW,"W"],["Battery",frame.mobility.batteryRemainingWh,"Wh"],["Stability",frame.mobility.stabilityMarginDeg,"°"]
] as const).map(([label,value,unit])=><div key={label}><dt>{localizeText(label)}</dt><dd>{value.toFixed(1)} <small>{unit}</small></dd></div>)}</dl></DetailSection>)}
          <div className="ml-event-heading">{localizeText("MISSION EVENTS")}{localizeText(" ")}
            <span>{localizeText(run?.events.filter((e) => e.t <= time).length ?? 0)}</span>
          </div>
          <ol className="ml-events">
            {localizeText(run ? (
              run.events
                .filter((e) => e.t <= time + 0.0001)
                .map((event, i) => (
                  <li key={i}>
                    <button
                      className="ml-event-jump"
                      aria-label={localizeText(`Jump to ${event.type}`)}
                      onClick={() => {
                        setPlaying(false);
                        setTime(event.t);
                      }}
                    >
                      <time>{localizeText(display(event.t, 1))}{localizeText(" s")}</time>
                    </button>
                    <strong>{localizeText(event.type)}</strong>
                    <ContextHelp label="Event details"><p>{localizeText(event.detail)}</p></ContextHelp>
                  </li>
                ))
            ) : (
              <li>
                <time>{localizeText("STANDBY")}</time>
                <p title={localizeText("Configure your experiment and start the calculation. Events appear at their recorded simulation times.")}>—</p>
              </li>
            ))}
          </ol>
        </aside>
      </div>
      {viewHandoff && scenePanel && <div className="scene-handoff" aria-live="polite"><span>{localizeText(explorerView === "planet" ? "PLANETARY CONTEXT" : explorerView === "region" || explorerView === "scientific" ? "MEASURED REGIONAL SURFACE" : "RECORDED VEHICLE STATE")}</span><b>{localizeText(terrain.name.split(" / ")[0])}</b><small>{explorerView === "planet" ? localizeText("Imagery for orientation") : `${terrain.grid.cell_m} m DEM · ${localizeText("interpolation adds no observations")}`}</small></div>}
      <div className="sim-transport" hidden={!scenePanel}><MissionTimeline
        snapshots={snapshots}
        requirements={requirements ?? defaultRequirements(scenario)}
        onEvent={() => goView(explorerView === "scientific" ? "scientific" : "follow")}
        run={run}
        time={time}
        playing={playing}
        speed={speed}
        terrain={terrain}
        view={explorerView}
        onView={goView}
        onSeek={(t) => {
          setPlaying(false);
          setTime(t);
        }}
        onPlay={() => {
          setExploded(0);
          if (completed) setTime(0);
          setPlaying(!playing);
        }}
        onSpeed={setSpeed}
      /></div>
      <section className="ml-results" hidden={activePanel === 'world'} aria-label={localizeText('Active engineering panel')}>
        {localizeText(guideStep === 4 && guide)}
        <header className="sim-panel-heading">
          <h2>{localizeText(RESULT_TABS.find(t=>t[0]===tab)?.[1] ?? '')}</h2>
          {localizeText(run && scenePanel && (
            <div className="ml-export-actions">
              <button onClick={() => {setBaseline(run);setTab('tests');}} title={localizeText('Pin as test baseline')} aria-label={localizeText('Pin as test baseline')}><Pin size={15}/></button>
              <button onClick={() => save(run)} title={localizeText('Save')}>
                <Save size={15} /><span className="sr-only">{localizeText("Save")}</span></button>
              <button onClick={() => setExportRun(run)} title={localizeText('JSON')}>
                <ArrowDownToLine size={15} /><span className="sr-only">{localizeText("JSON")}</span></button>
              <button
                onClick={() => downloadText(report(run), `egiz-${run.id}.md`)}
                title={localizeText('Report')}
              ><FileText size={15}/><span className="sr-only">{localizeText("Report")}</span></button>
            </div>
          ))}
          <button className="sim-close-panel" onClick={()=>setActivePanel('world')} aria-label={localizeText('Return to simulation')} title={localizeText('Return to simulation')}><X size={17}/></button>
        </header>
        <div hidden={tab!=='dynamics'}>{nativeVisited && <DynamicsWorkbench active={activePanel==='dynamics'} scenario={scenario} terrain={terrain} onInspect={openInspector}/>}</div>
        {tab === 'tests' && <ExperimentBench scenario={scenario} run={run} baseline={baseline} limits={requirements ?? defaultRequirements(scenario)} onLimits={setRequirements} busy={busy} invalid={errors.length>0} onPin={()=>{if(run)setBaseline(run);}} onClear={()=>setBaseline(null)} onRun={()=>void launch().then(()=>setTab('tests'))} onCompare={()=>{if(run&&baseline){setComparison([baseline,run]);setComparisonAutoOpen(true);setTab('compare');}}}>
          {scenario.mode==='rover' && scenario.rover.design && <OperatingSearch scenario={scenario} terrain={terrain} bundle={bundle} inputs={archivedInputs??bundle.inputs} requirements={requirements??defaultRequirements(scenario)} record={searchRecord} onRecord={setSearchRecord} busy={busy}
            onDemo={()=>{const next=defaultScenario(terrain);next.rover.speed=.2;update(next);setRequirements({...defaultRequirements(next),maxDurationS:7200,maxEnergyWh:400,minReserveWh:2500});}}
            onOpen={(r,limits)=>{replay(r);setRequirements(limits);setBaseline(searchRecord?.study.baseline.run??null);setTab('tests');}}
            onSeek={t=>{setTime(t);setPlaying(false);goView('follow');}}
            onCompare={records=>{setComparison(records);setComparisonAutoOpen(true);setTab('compare');}}
            onEarth={()=>{setTab('validation');setPlaying(false);}}/>}
        </ExperimentBench>}
        {localizeText(tab === "control" && <MissionControl key={run?.id??"empty"} run={run} time={time}/>)}
        {localizeText(tab === "engineering" && <>
          {localizeText(scenario.mode==="rover" ? <RoverEngineering scenario={scenario} frame={frame} onChange={update} busy={busy} exploded={exploded} onExplode={setExploded} validationErrors={errors}
            onInspect={()=>{setPlaying(false);goView("vehicle");document.querySelector(".ml-main-scene")?.scrollIntoView({behavior:"smooth",block:"center"});}}
            onRun={()=>void launch()} onSweep={()=>void tradeStudy()}/> : <p className="ml-tiny">{localizeText("Select Rover traverse for the mechanical engineering workspace.")}</p>)}
          <ScienceGeometry terrain={terrain} scenario={scenario} time={time} disabled={busy} onChange={update}/>
        </>)}
        {localizeText(tab === "validation" && <><TransferWorkspace runs={transferRuns} busy={busy} enabled={scenario.mode==="rover" && !!scenario.rover.design && terrain.body!=="earth"} onGenerate={()=>void missionCampaign()} onReplay={replay}/><ObservationWorkbench scenario={scenario} busy={busy} onApply={s=>{update(s);setTab("tests");}}/></>)}
        {localizeText(tab === "telemetry" &&
          (run ? (
            <div className="ml-charts">
              <TelemetryChart
                run={run}
                time={time}
                field={surface ? "energyWh" : "altitude"}
                label={
                  localizeText(surface
                    ? scenario.rover.design ? "Gross electrical consumption" : "Cumulative energy proxy"
                    : "Altitude above measured terrain")
                }
                unit={surface ? "Wh" : "m"}
              />
              <TelemetryChart
                run={run}
                time={time}
                field="speed"
                label={localizeText("Calculated speed")}
                unit="m/s"
              />
              {localizeText(run.frames[0].mobility && <>
                <TelemetryChart run={run} time={time} field="battery" label={localizeText("Battery remaining")} unit="Wh"/>
                <TelemetryChart run={run} time={time} field="electricalPower" label={localizeText("Electrical bus load")} unit="W"/>
                {localizeText(run.scenario.solar && <TelemetryChart run={run} time={time} field="solarPower" label={localizeText("SPICE-driven solar generation")} unit="W"/>)}
              </>)}
              {localizeText(!surface && (
                <TelemetryChart
                  run={run}
                  time={time}
                  field="dynamicPressure"
                  label={localizeText("Dynamic pressure")}
                  unit="Pa"
                />
              ))}
            </div>
          ) : (
            <div className="ml-empty-results">
              <FlaskConical size={24} />
              <div>
                <h2>{localizeText("No results yet")}</h2>
                <p>{localizeText("Run a mission to see charts and analysis.")}</p>
              </div>
            </div>
          )))}
        {localizeText(tab === "analysis" && (
          <div className="ml-analysis">
            {localizeText(run ? (
              <>
                <div className="ml-outcome">
                  <span>{localizeText("CALCULATED OUTCOME / ")}{localizeText(run.scenario.mode.toUpperCase())}
                  </span>
                  <h2>{localizeText(human(run.outcome))}</h2>
                  <p>{localizeText(run.explanation)}</p>
                  <div className="ml-metrics">
                    <div>
                      <span>
                        {localizeText(surface ? "Regional distance" : "Maximum altitude")}
                      </span>
                      <b>
                        {localizeText(display(
                          surface
                            ? run.metrics.distance
                            : run.metrics.maxAltitude,
                        ))}{localizeText(" ")}{localizeText("m")}</b>
                    </div>
                    <div>
                      <span>{localizeText("Peak speed")}</span>
                      <b>{localizeText(display(run.metrics.maxSpeed))}{localizeText(" m/s")}</b>
                    </div>
                    <div>
                      <span>
                        {localizeText(surface ? "Energy proxy" : "Propellant used")}
                      </span>
                      <b>
                        {localizeText(display(
                          surface ? run.metrics.energyWh : run.metrics.fuelUsed,
                        ))}{localizeText(" ")}
                        {localizeText(surface ? "Wh" : "kg")}
                      </b>
                    </div>
                    <div>
                      <span>
                        {localizeText(surface ? "Maximum regional slope" : "Downrange")}
                      </span>
                      <b>
                        {localizeText(display(
                          surface ? run.metrics.maxSlope : run.metrics.distance,
                        ))}{localizeText(" ")}
                        {localizeText(surface ? "°" : "m")}
                      </b>
                    </div>
                  </div>
                </div>
                <details>
                  <summary>{localizeText("Model, numerical method & limitations")}</summary>
                  <p>
                    {localizeText(run.integrator)}{localizeText(" · Δt ")}{localizeText(run.scenario.dt)}{localizeText(" s ·")}{localizeText(" ")}
                    {localizeText(run.frames.length.toLocaleString())}{localizeText(" snapshots")}</p>
                  <ul>
                    {localizeText(run.assumptions.map((a) => (
                      <li key={a}>{localizeText(a)}</li>
                    )))}
                  </ul>
                </details>
              </>
            ) : (
              <p>{localizeText("Run an experiment to inspect its calculated outcome.")}</p>
            ))}
            <div className="ml-surface-analysis">
              <div>
                <span>{localizeText("REGIONAL LINE OF SIGHT")}</span>
                <h3>{localizeText(los)}</h3>
                <ContextHelp label="Model & assumptions"><p>{localizeText("A ↔ B, 2 m endpoint heights, interpolated terrain only. Curvature, rocks and vegetation are unresolved; this is not a communications guarantee.")}</p></ContextHelp>
              </div>
              <div>
                <span>{localizeText("OBSERVATION MARKERS / ")}{localizeText(observations.length)}</span>
                {localizeText(observations.length ? (
                  observations.map((p, i) => (
                    <p key={i}>{localizeText("P")}{localizeText(i + 1)}{localizeText(" · E ")}{localizeText(display(p.x, 0))}{localizeText(" / N ")}{localizeText(display(p.y, 0))}{localizeText(" m ·")}{localizeText(" ")}
                      {localizeText(display(sampleTerrain(terrain, p) ?? undefined))}{localizeText(" m datum")}</p>
                  ))
                ) : (
                  <p>{localizeText("Use Add observation, then click the landscape to record locations.")}</p>
                ))}
                <button
                  onClick={() =>
                    downloadJson(
                      {
                        schema: "egiz.observations",
                        version: "1.0.0",
                        terrain,
                        inputs: bundle.inputs,
                        start: scenario.start,
                        destination: scenario.destination,
                        observations,
                        lineOfSight: los,
                      },
                      "egiz-observations.json",
                    )
                  }
                >
                  <ArrowDownToLine size={13} />{localizeText("Export surface plan")}</button>
              </div>
            </div>
          </div>
        ))}
        {localizeText(tab === "compare" && (
          <div className="ml-comparison">
            <div className="ml-comparison-intro">
              <div>
                <span className="ml-kicker">{localizeText("THE ANALOG EXPERIMENT")}</span>
                <h2>{localizeText("Same mission. Different worlds.")}</h2>
                <ContextHelp label="Model & assumptions"><p>{localizeText("Separate terrain effects from environmental effects. Run the planetary target and two Earth candidates with matched vehicle and local route inputs.")}</p></ContextHelp>
              </div>
              <div>
                <button
                  className="ml-secondary"
                  disabled={busy || errors.length > 0}
                  onClick={() => batch("analogs")}
                >
                  <GitCompareArrows size={15} />
                  {localizeText(busy ? "Calculating…" : "Run analog experiment")}
                </button>
                <button
                  disabled={busy || errors.length > 0}
                  onClick={() => batch("sensitivity")}
                >
                  <Plus size={14} />{localizeText("Sweep")}{localizeText(" ")}
                  {localizeText(surface
                    ? "slope limit"
                    : scenario.mode === "descent"
                      ? "initial speed"
                      : "thrust")}{localizeText(" ")}
                  ±20%
                </button>
              </div>
            </div>
            {localizeText(comparison.length > 0 && (
              <>
                <div className="ml-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{localizeText("Terrain / experiment")}</th>
                        <th>{localizeText("Environment")}</th>
                        <th>{localizeText("Varied parameter")}</th>
                        <th>{localizeText("Outcome")}</th>
                        <th>{localizeText("Peak AGL / route")}</th>
                        <th>{localizeText("Energy / fuel")}</th>
                        <th>{localizeText("Time")}</th>
                        <th>{localizeText("Review")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {localizeText(comparison.map((result) => (
                        <tr key={result.id}>
                          <td>
                            <strong>{localizeText(result.terrain.name)}</strong>
                            <small>{localizeText(human(result.scenario.kind))}</small>
                          </td>
                          <td>
                            {localizeText(result.scenario.environment.planet)}
                            <small>
                              {localizeText(result.scenario.environment.gravity)}{localizeText(" m/s²")}</small>
                          </td>
                          <td>
                            {localizeText(result.scenario.rover.design && result.scenario.mode==="rover" && <small>{localizeText("r ")}{localizeText(result.scenario.rover.design.wheelRadius.toFixed(2))}{localizeText(" m · τ ")}{localizeText(result.scenario.rover.design.stallTorque)}{localizeText(" N m")}</small>)}
                            {localizeText(result.scenario.mode === "rover" ||
                            result.scenario.mode === "eva"
                              ? `${result.scenario.rover.speed.toFixed(2)} m/s · ${result.scenario.rover.route} · ${result.scenario.rover.maxSlope}°`
                              : result.scenario.mode === "descent"
                                ? `${result.scenario.vehicle.initialVelocity} m/s initial`
                                : `${result.scenario.vehicle.thrust} N thrust`)}
                          </td>
                          <td>
                            <span
                              className={`ml-result-badge ${["soft_landing", "destination_reached"].includes(result.outcome) ? "good" : ""}`}
                            >
                              {localizeText(human(result.outcome))}
                            </span>
                          </td>
                          <td>
                            {localizeText(display(
                              result.scenario.mode === "rover" ||
                                result.scenario.mode === "eva"
                                ? result.metrics.distance
                                : result.metrics.maxAltitude,
                            ))}{localizeText(" ")}{localizeText("m")}</td>
                          <td>
                            {localizeText(display(
                              result.scenario.mode === "rover" ||
                                result.scenario.mode === "eva"
                                ? result.metrics.energyWh
                                : result.metrics.fuelUsed,
                            ))}{localizeText(" ")}
                            {localizeText(result.scenario.mode === "rover" ||
                            result.scenario.mode === "eva"
                              ? "Wh"
                              : "kg")}
                          </td>
                          <td>{localizeText(display(result.metrics.duration))}{localizeText(" s")}</td>
                          <td>
                            <button onClick={() => replay(result)}>{localizeText("Replay")}</button>
                            <button
                              aria-label={localizeText(`Save ${result.terrain.name} ${result.scenario.kind}`)}
                              onClick={() => save(result)}
                            >
                              <Save size={13} />
                            </button>
                          </td>
                        </tr>
                      )))}
                    </tbody>
                  </table>
                </div>
                <div className="ml-comparison-footer">
                  <p>
                    {
                      localizeText(comparison.filter(
                        (r) =>
                          r.outcome === "destination_reached" ||
                          r.outcome === "soft_landing",
                      ).length)
                    }{localizeText(" ")}{localizeText("of ")}{localizeText(comparison.length)}{localizeText(" configured runs met their explicit completion criteria. This finite set is not a success probability. Peak-speed range:")}{localizeText(" ")}
                    {localizeText(display(
                      Math.min(...comparison.map((r) => r.metrics.maxSpeed)),
                    ))}
                    –
                    {localizeText(display(
                      Math.max(...comparison.map((r) => r.metrics.maxSpeed)),
                    ))}{localizeText(" ")}{localizeText("m/s.")}</p>
                  <button
                    onClick={() =>
                      downloadJson(
                        {
                          schema: "egiz.experiment_comparison",
                          version: "1.0.0",
                          interpretation:
                            "Deterministic configured runs; not a probability sample.",
                          runs: comparison,
                        },
                        "egiz-comparison.json",
                      )
                    }
                  >
                    <ArrowDownToLine size={14} />{localizeText("Export comparison")}</button>
                </div>
                <ComparisonReplay key={comparison.map(r=>r.id).join(':')} runs={comparison} initiallyOpen={comparisonAutoOpen} />
                <ComparisonEvidence runs={comparison} />
              </>
            ))}
            <div className="ml-comparison-principles">
              <p>
                <b>{localizeText("Planet native")}</b>{localizeText("Real target terrain with its body’s reference environment.")}</p>
              <p>
                <b>{localizeText("Physical Earth analog")}</b>{localizeText("Terrestrial terrain and Earth physics, with assumed atmosphere.")}</p>
              <p>
                <b>{localizeText("Controlled counterfactual")}</b>{localizeText("The same Earth terrain with substituted target physics.")}</p>
            </div>
          </div>
        ))}
        {localizeText(tab === "experiments" && (
          <div className="ml-library">
            <div className="ml-library-heading">
              <div>
                <h2>{localizeText("Your experiment archive")}</h2>
                <p>{localizeText("Saved on this device. Export JSON for portable reproduction; imports re-execute their embedded inputs.")}</p>
              </div>
              <button
                className="ml-secondary"
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              >
                <Upload size={14} />{localizeText("Import & reproduce")}</button>
              <input
                ref={fileInput}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void importFile(file);
                  e.target.value = "";
                }}
              />
            </div>
            {localizeText(library.length ? (
              library.map((result) => (
                <article key={result.id}>
                  <div>
                    <span>
                      {localizeText(names[result.scenario.mode])} ·{localizeText(" ")}
                      {localizeText(human(result.scenario.kind))}
                    </span>
                    <h3>{localizeText(result.terrain.name)}</h3>
                    <p>
                      {localizeText(human(result.outcome))} ·{localizeText(" ")}
                      {localizeText(new Date(result.createdAt).toLocaleString())} ·{localizeText(" ")}
                      {localizeText(result.frames.length.toLocaleString())}{localizeText(" states")}</p>
                  </div>
                  <button onClick={() => replay(result)}>
                    <Play size={14} />{localizeText("Replay")}</button>
                  <button
                    onClick={() =>
                      setComparison((list) =>
                        list.some((r) => r.id === result.id)
                          ? list
                          : [...list, result],
                      )
                    }
                  >
                    <Plus size={14} />{localizeText("Compare")}</button>
                  <button
                    onClick={() =>
                      downloadJson(result, `egiz-${result.id}.json`)
                    }
                    aria-label={localizeText(`Export ${result.id}`)}
                  >
                    <ArrowDownToLine size={15} />
                  </button>
                  <button
                    aria-label={localizeText(`Delete ${result.id}`)}
                    onClick={async () => {
                      try {
                        await deleteRun(result.id);
                        setLibrary(await savedRuns());
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </article>
              ))
            ) : (
              <p className="ml-tiny">{localizeText("No saved experiments yet. Complete a calculation and choose Save.")}</p>
            ))}
          </div>
        ))}
      </section>
      </div>
      <footer className="sim-statusbar">
        {scenario.calibration && <span className="observation-label">{localizeText(scenario.calibration.observations.synthetic?"SYNTHETIC CALIBRATION":"EARTH CALIBRATION")}</span>}
        <span className="sim-status-chip"><i className={busy?'computing':run?'recorded':''}/>{localizeText(busy?'CALCULATING':scenePanel?(run?'RECORDED RUN':'READY TO CONFIGURE'):'ENGINEERING WORKSPACE')}</span>
        <span title={localizeText(scenePanel ? (run?.model ?? 'Fast analytical model') : 'Specialized tools use their own declared solvers and recorded time.')}><Gauge size={13}/>{localizeText(scenePanel ? 'FAST' : activePanel==='dynamics' ? 'RESEARCH' : 'TOOLS')}{scenePanel && run && <code>{run.id.slice(0, 10)}</code>}</span>
        {scenePanel && <span className="sim-source-status"><Mountain size={13}/>{terrain.grid.cell_m} m DEM</span>}
        {baseline && <span className="sim-baseline-status"><ClipboardCheck size={13}/>{localizeText('Baseline pinned')}</span>}
        {busy && <button className="sim-cancel" onClick={()=>cancelWorker.current?.()}><Square size={12}/>{localizeText('Cancel calculation')}</button>}
      </footer>
      {localizeText(exportRun && (
        <ExperimentExport run={exportRun} onClose={() => setExportRun(null)} />
      ))}
      <details className="ml-provenance-details">
        <summary><ShieldCheck size={15} />{localizeText("Terrain data")}<ChevronDown size={14} /></summary>
        <div className="ml-provenance">
        <div>
          <ShieldCheck size={17} />
          <p>
            <strong>{localizeText("Observed terrain. Explicit assumptions.")}</strong>
            <span>
              {localizeText(terrain.grid.side)} × {localizeText(terrain.grid.side)}{localizeText(" samples ·")}{localizeText(" ")}
              {localizeText(terrain.grid.cell_m)}{localizeText(" m reconstruction · source pixels ≈")}{localizeText(terrain.source_pixel_m)}{localizeText(" m ·")}{localizeText(" ")}
              {localizeText((terrain.grid.valid_fraction * 100).toFixed(1))}{localizeText("% valid")}</span>
          </p>
        </div>
        <a href={terrain.source.url} target="_blank" rel="noreferrer">{localizeText("Source raster ")}<ArrowRight size={13} />
        </a>
        <code title={terrain.source.sha256}>
          SHA-256 {terrain.source.sha256.slice(0, 14)}…
        </code>
        <p>{localizeText("Regional screening and educational simulation. Sub-grid hazards, spacecraft dynamics and site weather remain unvalidated.")}</p>
        <button className="provenance-method" onClick={() => navigate("evidence")}>{localizeText("Sources & limitations")}<ArrowRight size={13} /></button>
        </div>
      </details>
    </main>
  );
}
