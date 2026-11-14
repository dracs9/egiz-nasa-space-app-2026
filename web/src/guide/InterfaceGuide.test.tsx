import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InterfaceGuide } from './InterfaceGuide';
import { setLanguage } from '../i18n';
let root:Root;
beforeEach(()=>{
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  setLanguage('en',false);HTMLElement.prototype.scrollIntoView=vi.fn();
  document.body.innerHTML='<main><aside class="ml-setup"><div class="ex-schematic"><button id="preview">Vehicle</button></div><label><span>Wheel radius</span><input id="radius" value="0.41" data-guide-field="wheelRadius" /></label></aside><div class="clear-stepbar">Workflow</div></main><div id="guide-root"></div>';
  root=createRoot(document.getElementById('guide-root')!);
  act(()=>root.render(<InterfaceGuide route="lab"/>));
});
afterEach(()=>{act(()=>root.unmount());document.body.innerHTML='';});
function click(name:string){const button=[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.getAttribute('aria-label')===name)!;act(()=>button.click());}
it('explains the most specific nested section and a field without changing its value',()=>{
  click('Interface guide');
  act(()=>document.getElementById('preview')!.dispatchEvent(new Event('pointerover',{bubbles:true})));
  expect(document.querySelector('.interface-guide-panel h2')?.textContent).toBe('Detailed equipment');
  const field=document.getElementById('radius') as HTMLInputElement;
  act(()=>field.dispatchEvent(new Event('focusin',{bubbles:true})));
  expect(document.querySelector('.interface-guide-panel h2')?.textContent).toBe('Wheel radius');
  expect(document.querySelector('.interface-guide-panel p')?.textContent).toContain('torque to drive force');
  expect(field.value).toBe('0.41');
  act(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})));
  expect(document.querySelector('.interface-guide-panel')).toBeNull();
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Interface guide');
});
it('replaces explanations when navigating to a different workspace',()=>{
  click('Interface guide');
  act(()=>root.render(<InterfaceGuide route="matrix"/>));
  expect(document.querySelector('.interface-guide-panel h2')?.textContent).toBe('Attribute fidelity matrix');
  click('Next explanation');
  expect(document.querySelector('.interface-guide-panel h2')?.textContent).toBe('Cell evidence');
  click('Close interface guide');
  expect(document.querySelector('.interface-guide-outline')).toBeNull();
});
