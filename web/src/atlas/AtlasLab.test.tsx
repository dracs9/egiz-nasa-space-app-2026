// Node built-ins are available in Vitest; the app tsconfig intentionally has no @types/node.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
declare const process: { cwd(): string };
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../i18n';
import { useAppStore } from '../state/store';
import AtlasLab, { loadAtlas, markdownToBlocks } from './AtlasLab';
import type { AtlasBundle } from './types';

const bundlePath = [resolve(process.cwd(), '../data/pilot/atlas_pi.json'), resolve(process.cwd(), 'data/pilot/atlas_pi.json')].find((p: string) => existsSync(p)) ?? '';
const text = bundlePath ? readFileSync(bundlePath, 'utf8') : null;
let root: Root | undefined;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  setLanguage('en', false); document.body.innerHTML = '<div id="atlas"></div>';
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; vi.restoreAllMocks(); });

const mount = async () => { root = createRoot(document.getElementById('atlas')!); await act(async () => root!.render(<AtlasLab />)); await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };
const click = async (el: Element | undefined | null) => { expect(el).toBeTruthy(); await act(async () => (el as HTMLElement).click()); };

describe('ATLAS-Π workspace', () => {
  it('refuses synthetic demo data instead of showing fabricated results', async () => {
    useAppStore.setState({ dataMode: 'demo' });
    await mount();
    expect(document.body.textContent).toContain('runs only on measured data');
    expect(document.querySelector('.atlas-matrix')).toBeNull();
  });
  it('rejects bundles that are synthetic or malformed', async () => {
    const fake = vi.fn(async () => new Response(JSON.stringify({ schema: 'egiz.atlas_pi', version: '1.0.0', synthetic: true, tensor: { cells: [] } })));
    await expect(loadAtlas(fake as unknown as typeof fetch, 'data/pilot')).rejects.toThrow('unsupported');
    const missing = vi.fn(async () => new Response('', { status: 404 }));
    await expect(loadAtlas(missing as unknown as typeof fetch, 'data/pilot')).rejects.toThrow('not found');
  });
  it.skipIf(!text)('renders the measured tensor, certificate, constellation and validation views', async () => {
    useAppStore.setState({ dataMode: 'pilot' });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(text!));
    await mount();
    const doc = JSON.parse(text!) as AtlasBundle;
    const cells = document.querySelectorAll('.atlas-cell');
    const mars = doc.tensor.cells.filter(c => c.target === 'MARS_JEZERO');
    expect(cells.length).toBe(mars.length);
    const supported = document.querySelector('.atlas-cell.s-supported');
    await click(supported ?? cells[0]);
    expect(document.querySelector('.atlas-detail')?.textContent).toContain('CERT-');
    expect(document.querySelector('.atlas-trace')?.textContent).toMatch(/DS:|REF:|LIT:/);
    await click([...document.querySelectorAll('.atlas-tabs button')].find(b => b.textContent === 'Analog constellation'));
    const selected = doc.constellations.MARS_JEZERO_CAMPAIGN['3'].selected;
    expect(document.querySelectorAll('.atlas-portfolio li').length).toBe(selected.length);
    expect(document.body.textContent).toContain('Lab-only tasks');
    await click([...document.querySelectorAll('.atlas-tabs button')].find(b => b.textContent === 'Counterfactual physics'));
    expect(document.body.textContent).toContain('contested');
    await click([...document.querySelectorAll('.atlas-tabs button')].find(b => b.textContent === 'Validation'));
    expect(document.body.textContent).toContain('H6');
    expect(document.body.textContent).toContain('not run');
  });
});

describe('dossier markdown renderer', () => {
  it('renders headings, tables, lists and code without HTML injection', () => {
    root = createRoot(document.getElementById('atlas')!);
    const md = '# Title\n\n## Part\n\n| A | B |\n|---|---|\n| **x** | `y` |\n\n- one\n- <img src=x onerror=alert(1)>\n';
    act(() => root!.render(<div>{markdownToBlocks(md)}</div>));
    expect(document.querySelector('h1')?.textContent).toBe('Title');
    expect(document.querySelector('td strong')?.textContent).toBe('x');
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelectorAll('li').length).toBe(2);
  });
});
