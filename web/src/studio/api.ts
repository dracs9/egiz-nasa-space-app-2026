// Shared Mission Studio state contract (one consistent interaction model for every panel).
import { createContext, useContext } from 'react';
import type { World } from '../world/core/world';
import type { WorldView, OverlayMode, CameraMode, QualityName, ViewStats } from '../world/render/worldView';
import type { MissionSpec } from '../world/sim/mission';
import type { PlanResult } from '../world/sim/pipeline';
import type { SimResult } from '../world/sim/traverse';
import type { CopilotAnswer } from '../world/intelligence/copilot';
import type { Selection, ToolCallLog } from '../world/intelligence/tools';
import type { QualityCheck } from '../world/intelligence/quality';
import type { AtlasBundle } from '../atlas/types';
import type { MapPoint } from '../world/core/types';

export type Panel = 'explore' | 'terrain' | 'intelligence' | 'mission' | 'simulate' | 'compare' | 'evidence';
export type PickMode = 'inspect' | 'profile' | 'start' | 'destination' | 'waypoint';
export interface Variant { id: string; label: string; spec: MissionSpec; result: SimResult; baseRouteId: string }

export interface StudioApi {
  world: World; view: WorldView | null;
  panel: Panel; setPanel(p: Panel): void;
  selection: Selection | null; select(s: Selection | null, fly?: boolean): void;
  overlay: OverlayMode; slopeLimit: number; setOverlay(m: OverlayMode, slopeLimit?: number): void;
  contours: number; setContours(v: number): void;
  illustrative: boolean; setIllustrative(v: boolean): void;
  rockK: number; setRockK(v: number): void;
  showAll: boolean; setShowAll(v: boolean): void;
  highlight: { ids: string[]; label: string } | null; setHighlight(h: { ids: string[]; label: string } | null): void;
  cameraMode: CameraMode; setCameraMode(m: CameraMode): void;
  quality: QualityName; setQuality(q: QualityName): void; stats: ViewStats | null;
  exposure: number; setExposure(v: number): void;
  time: number; setTime(t: number): void;
  mission: MissionSpec; setMission(m: MissionSpec): void;
  plan: PlanResult | null; planning: string | null; runPlan(spec?: MissionSpec): Promise<PlanResult | null>;
  activeRouteId: string | null; setActiveRoute(id: string): void;
  playback: number; playing: boolean; setPlaying(v: boolean): void; seek(t: number): void; pbSpeed: number; setPbSpeed(v: number): void;
  pickMode: PickMode; setPickMode(m: PickMode): void;
  profilePts: MapPoint[]; setProfilePts(p: MapPoint[]): void;
  answers: CopilotAnswer[]; ask(text: string): Promise<void>; asking: boolean;
  toolLog: ToolCallLog[];
  llmOn: boolean; setLlmKey(key: string | null): void;
  variants: Variant[]; addVariant(v: Variant): void; clearVariants(): void;
  quality_checks: QualityCheck[] | null; runChecks(): Promise<void>;
  atlas: AtlasBundle | null;
  download(name: string, text: string, mime: string): void;
  dossier(): Promise<{ markdown: string; json: Record<string, unknown>; inputHash: string; outputHash: string }>;
  activeSim: SimResult | null;
}

export const StudioContext = createContext<StudioApi | null>(null);
export function useStudio() { const v = useContext(StudioContext); if (!v) throw new Error('Studio context missing'); return v; }
