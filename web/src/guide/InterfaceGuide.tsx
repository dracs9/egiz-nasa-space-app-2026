import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CircleHelp, MousePointer2, X } from 'lucide-react';
import { t, useLanguage } from '../i18n';
import type { Route } from '../state/store';
import { FIELD_HELP, topicsFor, type GuideTopic } from './topics';
import './interface-guide.css';

export function InterfaceGuide({route}:{route:Route}) {
  useLanguage();const [open,setOpen]=useState(false),[index,setIndex]=useState(0),[field,setField]=useState<{title:string;body:string}|null>(null),[rect,setRect]=useState<{left:number;top:number;width:number;height:number}|null>(null);
  const topics=topicsFor(route),current=topics[Math.min(index,topics.length-1)],target=useRef<Element|null>(null),panel=useRef<HTMLElement>(null),toggle=useRef<HTMLButtonElement>(null);
  const close=()=>{setOpen(false);setRect(null);toggle.current?.focus();};
  useEffect(()=>{setIndex(0);setField(null);setRect(null);target.current=null;},[route]);
  useEffect(()=>{
    if(!open)return;
    const measure=()=>{if(!target.current?.isConnected){setRect(null);return;}const b=target.current.getBoundingClientRect();setRect(b.width&&b.height?{left:b.left,top:b.top,width:b.width,height:b.height}:null);};
    const inspect=(event:Event)=>{
      const element=event.target;if(!(element instanceof Element)||panel.current?.contains(element)||toggle.current?.contains(element))return;
      const control=element.closest<HTMLElement>('[data-guide-field]');
      let node:Element|null=element,match=-1;
      while(node&&match<0){match=topics.findIndex(topic=>node!.matches(topic.selector));if(match<0)node=node.parentElement;}
      if(match<0)return;
      setIndex(match);
      if(control&&FIELD_HELP[control.dataset.guideField!]){const label=control.closest('label');setField({title:label?.querySelector('span')?.firstChild?.textContent?.trim()??control.getAttribute('aria-label')??current.title,body:FIELD_HELP[control.dataset.guideField!]});target.current=label??control;}
      else{setField(null);target.current=element.closest(topics[match].selector);}
      measure();
    };
    const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);setRect(null);toggle.current?.focus();}};
    document.addEventListener('pointerover',inspect);document.addEventListener('focusin',inspect);window.addEventListener('scroll',measure,true);window.addEventListener('resize',measure);window.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerover',inspect);document.removeEventListener('focusin',inspect);window.removeEventListener('scroll',measure,true);window.removeEventListener('resize',measure);window.removeEventListener('keydown',escape);};
  },[open,route]);
  function reveal(topic:GuideTopic,next:number) {
    setField(null);setIndex(next);const element=Array.from(document.querySelectorAll<HTMLElement>(topic.selector)).find(e=>{const b=e.getBoundingClientRect();return b.width>0&&b.height>0;});target.current=element??null;
    if(element){let ancestor:HTMLElement|null=element;while(ancestor){if(ancestor instanceof HTMLDetailsElement)ancestor.open=true;ancestor=ancestor.parentElement;}element.scrollIntoView({block:'nearest',behavior:'instant'});const b=element.getBoundingClientRect();setRect({left:b.left,top:b.top,width:b.width,height:b.height});}else setRect(null);
  }
  return <><button ref={toggle} className={`interface-guide-toggle ${open?'active':''}`} aria-label={t('Interface guide')} aria-expanded={open} title={t('Interface guide')} onClick={()=>{if(open)close();else{setOpen(true);reveal(current,index);}}}><CircleHelp size={20}/><span>{t('Guide')}</span></button>
    {open&&<><div className="interface-guide-outline" aria-hidden="true" style={rect?{left:rect.left+3,top:rect.top+3,width:Math.max(0,rect.width-6),height:Math.max(0,rect.height-6)}:{display:'none'}}/><aside ref={panel} className="interface-guide-panel" aria-label={t('Interface guide')}><header><div><MousePointer2 size={16}/>{t('GUIDE')}</div><button aria-label={t('Close interface guide')} onClick={close}><X size={17}/></button></header><h2>{field?.title??t(current.title)}</h2><p>{t(field?.body??current.body)}</p><div className="interface-guide-action">{t(field?'Change the value to use it in the next experiment.':current.action)}</div><footer><button aria-label={t('Previous explanation')} onClick={()=>{const next=(index-1+topics.length)%topics.length;reveal(topics[next],next);}}><ArrowLeft size={17}/></button><span>{index+1} / {topics.length}</span><button aria-label={t('Next explanation')} onClick={()=>{const next=(index+1)%topics.length;reveal(topics[next],next);}}><ArrowRight size={17}/></button></footer><details><summary>{t('All explanations')}</summary>{topics.map((topic,i)=><button key={topic.id} aria-current={i===index?'step':undefined} onClick={()=>reveal(topic,i)}>{t(topic.title)}</button>)}</details><small>{t('Point to a section or focus a control to learn what it does.')}</small></aside></>}
  </>;
}
