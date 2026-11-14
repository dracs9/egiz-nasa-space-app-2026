import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { message } from './messages';
import { initializeLanguage, LANGUAGE_KEY, LanguageSwitcher, setLanguage, t, useLanguage } from './index';

let root: Root | undefined;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); setLanguage('en', false);
  document.body.innerHTML = '<div id="localization-test"></div>';
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined; vi.restoreAllMocks(); setLanguage('en', false);
});
describe('Russian interface', () => {
  it('starts in English (default for judges) and restores the saved Russian preference', () => {
    initializeLanguage(); expect(useLanguage.getState().language).toBe('en'); expect(document.documentElement.lang).toBe('en');
    setLanguage('ru'); initializeLanguage(); expect(useLanguage.getState().language).toBe('ru');
    localStorage.setItem(LANGUAGE_KEY, 'invalid'); initializeLanguage(); expect(useLanguage.getState().language).toBe('en');
  });
  it('switches mounted content without resetting engineering state', async () => {
    const { useState } = await import('react');
    function Example() {
      useLanguage(); const [mass, setMass] = useState(900);
      return <><LanguageSwitcher /><h1>{t('Mission configuration')}</h1><input aria-label="mass" type="number" value={mass} onChange={e => setMass(Number(e.target.value))} /><button onClick={() => setMass(1250)}>payload</button></>;
    }
    root = createRoot(document.getElementById('localization-test')!);
    await act(async () => root!.render(<Example />));
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="Русский"]')!.click());
    expect(document.querySelector('h1')?.textContent).toBe('Конфигурация миссии');
    expect(document.querySelector('[aria-label="Русский"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem(LANGUAGE_KEY)).toBe('ru');
    await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === 'payload')!.click());
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="English"]')!.click());
    expect(document.querySelector<HTMLInputElement>('input')!.value).toBe('1250');
    expect(document.querySelector('h1')?.textContent).toBe('Mission configuration');
    expect(document.documentElement.lang).toBe('en');
  });
  it('preserves numeric records, source identifiers and unknown technical text', () => {
    setLanguage('ru'); const record = { body: 'mars', mass: 900, sourceSha256: 'abc123' };
    expect(t(record)).toBe(record); expect(t(900)).toBe(900); expect(t('egiz.dynamics_experiment')).toBe('egiz.dynamics_experiment');
    expect(t('  Start guide ')).toBe('  Начать обучение ');
    expect(t(['Mars', 2])).toEqual(['Марс', 2]);
  });
  it('localizes uppercase telemetry labels and interpolated UI prose', () => {
    setLanguage('ru'); expect(t('GROUND SPEED')).toBe('СКОРОСТЬ ПО ПОВЕРХНОСТИ');
    expect(message('Explore {region}', 'Изучить {region}', {region:'Jezero'})).toBe('Изучить Джезеро');
    expect(message('Mass {mass}', 'Масса {mass}', {mass:1250})).toBe('Масса 1250');
    setLanguage('en'); expect(message('Explore {region}', 'Изучить {region}', {region:'Jezero'})).toBe('Explore Jezero');
  });
  it('continues operating when local preference storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => initializeLanguage()).not.toThrow(); expect(t('Earth')).toBe('Earth');
    expect(() => setLanguage('ru')).not.toThrow(); expect(t('Earth')).toBe('Земля');
    expect(() => setLanguage('en')).not.toThrow(); expect(t('Earth')).toBe('Earth');
  });
});
