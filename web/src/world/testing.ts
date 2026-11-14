// Test helper: load the real world package from data/world via the filesystem (Vitest/Node only).
// Node built-ins are available in Vitest; the app tsconfig intentionally has no @types/node.
// @ts-expect-error untyped node built-in
import { readFile } from 'node:fs/promises';
// @ts-expect-error untyped node built-in
import { existsSync } from 'node:fs';
// @ts-expect-error untyped node built-in
import { resolve, join } from 'node:path';
import { World, type Fetcher } from './core/world';

declare const process: { cwd(): string };
export const WORLD_DIR: string = [resolve(process.cwd(), '../data/world/moon-mons-mouton'), resolve(process.cwd(), 'data/world/moon-mons-mouton')].find((p: string) => existsSync(p)) ?? '';
export const fsFetcher: Fetcher = async p => { const b = await readFile(join(WORLD_DIR, p)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
let cached: Promise<World> | null = null;
export function loadTestWorld() { return (cached ??= World.load(fsFetcher)); }
