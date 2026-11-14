// EGIZ Planetary Studio · controller shared by the shell and its panels (kept in its own module so the shell and
// panels do not import each other), plus the error boundary that keeps a render fault from blanking the workspace.
import { Component, createContext, useContext, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Info } from 'lucide-react';
import { usePlanet } from '../workspace/store';
import type { XY } from '../../astral/world/field';
import type { Compute } from '../compute';
import type { IntelAction } from '../intel/engine';
import type { TerrainView } from '../render/terrainView';
import type { Raster } from '../terrain/derive';
import type { SiteRef } from '../terrain/site';
import type { MissionPlan } from '../twin/twin';
import type { StreamRef } from '../workspace/investigation';
import type { BuiltLayer, LayerId } from './layers';

export interface Appearance { mode: string; layer: LayerId | null; opacity: number; contourM: number; exaggeration: number; exposure: number | null; tint: boolean; craters: boolean }
export interface Ctl {
  view: TerrainView | null; compute: Compute | null; appearance: Appearance; setAppearance(p: Partial<Appearance>): void; built: BuiltLayer | null;
  insolation: { lit: Raster; irradiance: Raster } | null; insolating: string | null; computeInsolation(): void;
  open(target: { ref?: SiteRef; stream?: StreamRef }): void; execute(a: IntelAction): void; finishDraft(): void;
  playT: number; setPlayT(t: number): void; playing: boolean; setPlaying(p: boolean): void; activeProfile: string | null; setActiveProfile(id: string | null): void;
}
export const CtlContext = createContext<Ctl | null>(null);
export function useCtl(): Ctl { const c = useContext(CtlContext); if (!c) throw new Error('Planetary Studio panels must render inside the workspace.'); return c; }
export const emptyPlan = (start: XY, timeS: number): MissionPlan => ({ start, destination: start, waypoints: [], hazards: [], objective: 'safest', maxSlopeDeg: 15, reserveFraction: 0.2, startTimeS: timeS, requireDaylight: false, fidelity: 'fast' });

/** Right-hand panel: stays mounted when collapsed (state is kept), with a handle on its edge. `\\` toggles it. */
export function PanelShell({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  const open = usePlanet(s => s.panelOpen), notes = usePlanet(s => s.notesOn), set = usePlanet(s => s.set);
  return <aside className={`pl-panel ${wide ? 'pl-panel-wide' : ''} ${open ? '' : 'closed'}`} aria-label={label}>
    <div className="pl-panel-handle">
      <button onClick={() => set({ panelOpen: !open })} aria-expanded={open} aria-label={open ? 'Collapse panel' : 'Expand panel'} title={open ? 'Collapse panel (\\)' : 'Expand panel (\\)'}>{open ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}</button>
      {open && <button className={notes ? 'on' : ''} onClick={() => set({ notesOn: !notes })} aria-pressed={notes} aria-label="Show method notes and assumptions" title="Method notes and assumptions"><Info size={13} /></button>}
    </div>
    <div className="pl-panel-scroll" hidden={!open}>{children}</div>
  </aside>;
}

export class StudioBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return <main className="pl-root pl-crash" role="alert"><div><h1>The Planetary Studio stopped</h1><p>{this.state.error.message}</p><p>Your investigation is saved in this browser. Reloading restores it.</p>
      <button onClick={() => this.setState({ error: null })}>Try again</button> <button onClick={() => window.location.reload()}>Reload</button></div></main>;
  }
}
