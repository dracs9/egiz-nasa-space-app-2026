// Presentation helper: absent measurements must never be shown as a measured zero.
import type { EarthTile, Run } from '../types/contracts';
export function objectiveAvailability(run: Run, objective: string, tiles: EarthTile[], lens: 'global' | 'kazakhstan') {
  const pool = tiles.filter(tile => tile.pool !== 'control' && (lens === 'global' || tile.pool === 'kazakhstan'));
  const known = pool.map(tile => run.fidelity[objective]?.[tile.id]?.F).filter((value): value is number => value != null);
  return { count: known.length, ceiling: known.length ? Math.max(...known) : null };
}
