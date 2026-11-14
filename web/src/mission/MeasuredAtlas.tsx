import { ContextHelp } from '../components/ContextHelp';
import { t as localizeText, useLanguage } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { downloadJson } from '../lib/download';
import type { MissionTerrain } from './types';
interface TileInfo {key:string;level:number;west:number;north:number;size:number;posting:number;sha256:string;bytes:number}
interface Manifest {schema:string;synthetic:false;site:MissionTerrain;sourceSha256:string;sourcePostingM:number;tiles:TileInfo[];method:string;limits:string}
interface Tile {key:string;side:number;west:number;north:number;size:number;elevations:(number|null)[]}
export function MeasuredAtlas(){
  useLanguage();
  const host=useRef<HTMLDivElement>(null),[manifest,setManifest]=useState<Manifest|null>(null),[error,setError]=useState(''),[stats,setStats]=useState('Loading fingerprinted measured geometry…'),[measure,setMeasure]=useState<number[][]>([]),[measureSources,setMeasureSources]=useState<TileInfo[]>([]),[layer,setLayer]=useState('surface');
  const settings=useRef({layer,measure:false,zoom:0,grazing:false});settings.current.layer=layer;
  useEffect(()=>{
    let alive=true,cleanup:undefined|(()=>void);const controller=new AbortController();
    async function start(){
      const base=`${import.meta.env.BASE_URL}terrain/moon-mouton/`;
      const response=await fetch(base+'manifest.json',{signal:controller.signal});if(!response.ok)throw Error('Measured terrain pyramid unavailable; run make terrain-build');
      const m:Manifest=await response.json();if(m.schema!=='egiz.measured_mesh_pyramid'||m.synthetic!==false||m.sourceSha256!==m.site.source.sha256)throw Error('Terrain provenance mismatch');if(!alive)return;setManifest(m);
      const renderer=new T.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(1.5,devicePixelRatio));renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.2;host.current!.append(renderer.domElement);
      const scene=new T.Scene();scene.background=new T.Color('#080d14');
      const camera=new T.PerspectiveCamera(42,1,1,100000);camera.position.set(2200,2600,2700);
      const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.minDistance=80;controls.maxDistance=20000;controls.maxPolarAngle=Math.PI*.48;
      scene.add(new T.HemisphereLight('#bccde3','#171923',1.2));const sun=new T.DirectionalLight('#fff4df',3.5);sun.position.set(-1500,2400,1300);scene.add(sun);
      const datum=m.site.grid.elevation_m.filter((n):n is number=>n!==null).reduce((a,b)=>a+b,0)/m.site.grid.elevation_m.filter(n=>n!==null).length;
      const meshes=new Map<string,T.Mesh>(),pending=new Set<string>();let bytes=0,level=-1,paint='',last=0,raf=0,zoom=0;const points:T.Vector3[]=[],pointSources:TileInfo[]=[];
      const line=new T.Line(new T.BufferGeometry(),new T.LineBasicMaterial({color:'#f4d18d',depthTest:false}));line.renderOrder=10;scene.add(line);
      async function load(info:TileInfo){
        if(meshes.has(info.key)||pending.has(info.key))return;pending.add(info.key);
        try{
          const res=await fetch(base+info.key+'.json',{signal:controller.signal});if(!res.ok)throw Error('Measured tile request failed');
          const buffer=await res.arrayBuffer();const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))).map(v=>v.toString(16).padStart(2,'0')).join('');if(digest!==info.sha256)throw Error('Measured tile fingerprint mismatch');
          const tile:Tile=JSON.parse(new TextDecoder().decode(buffer));if(!alive)return;
          const positions:number[]=[],indices:number[]=[];
          for(let i=0;i<tile.elevations.length;i++){const row=Math.floor(i/tile.side),col=i%tile.side;positions.push(tile.west+col*tile.size/(tile.side-1),(tile.elevations[i]??datum)-datum,-tile.north+row*tile.size/(tile.side-1));}
          for(let row=0;row<100;row++)for(let col=0;col<100;col++){const a=row*101+col,b=a+1,c=a+101,d=c+1;if([a,b,c,d].every(i=>tile.elevations[i]!==null))indices.push(a,c,b,b,c,d);}
          const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(positions,3));geo.setIndex(indices);geo.computeVertexNormals();
          const material=new T.MeshStandardMaterial({color:'#a1a5ab',roughness:.97,side:T.FrontSide,vertexColors:true});geo.setAttribute('color',new T.Float32BufferAttribute(new Float32Array(positions.length).fill(1),3));
          const mesh=new T.Mesh(geo,material);mesh.visible=false;mesh.userData.info=info;meshes.set(info.key,mesh);scene.add(mesh);bytes+=buffer.byteLength;paint='';
        }catch(e){if(alive&&!controller.signal.aborted)setError((e as Error).message);}finally{pending.delete(info.key);}
      }
      const resize=new ResizeObserver(()=>{renderer.setSize(host.current!.clientWidth,host.current!.clientHeight);camera.aspect=host.current!.clientWidth/host.current!.clientHeight;camera.updateProjectionMatrix();});resize.observe(host.current!);
      const ray=new T.Raycaster(),mouse=new T.Vector2();
      const click=(e:MouseEvent)=>{if(!settings.current.measure)return;const rect=renderer.domElement.getBoundingClientRect();mouse.set((e.clientX-rect.left)/rect.width*2-1,1-(e.clientY-rect.top)/rect.height*2);ray.setFromCamera(mouse,camera);const hit=ray.intersectObjects([...meshes.values()].filter(t=>t.visible))[0];if(!hit)return;if(points.length===2){points.length=0;pointSources.length=0;}points.push(hit.point);pointSources.push(hit.object.userData.info as TileInfo);setMeasureSources([...pointSources]);line.geometry.dispose();line.geometry=new T.BufferGeometry().setFromPoints(points);setMeasure(points.map(p=>[p.x,-p.z,p.y+datum]));};renderer.domElement.addEventListener('click',click);
      function draw(now:number){if(!alive)return;raf=requestAnimationFrame(draw);if(zoom!==settings.current.zoom){const delta=settings.current.zoom-zoom;camera.position.sub(controls.target).multiplyScalar(Math.pow(.65,delta)).add(controls.target);zoom=settings.current.zoom;}sun.position.y=settings.current.grazing?350:2400;controls.update();const distance=camera.position.distanceTo(controls.target),wanted=distance<2000?2:distance<4500?1:0;
        for(let l=0;l<=wanted;l++)for(const info of m.tiles.filter(t=>t.level===l))void load(info);
        let next=0;for(let l=0;l<=wanted;l++)if(m.tiles.filter(t=>t.level===l).every(t=>meshes.has(t.key)))next=l;else break;
        if(level!==next||paint!==settings.current.layer){level=next;paint=settings.current.layer;
          for(const mesh of meshes.values()){const info=mesh.userData.info as TileInfo;mesh.visible=info.level===level;const geo=mesh.geometry,pos=geo.getAttribute('position'),norm=geo.getAttribute('normal'),colors=geo.getAttribute('color'),color=new T.Color();
            for(let i=0;i<pos.count;i++){if(paint==='slope'){const deg=Math.acos(Math.max(-1,Math.min(1,norm.getY(i))))*180/Math.PI;color.setHSL(.4-Math.min(1,deg/40)*.38,.55,.4);}else if(paint==='elevation')color.setHSL(.57-Math.min(1,Math.max(0,(pos.getY(i)+700)/1400))*.5,.35,.45);else color.setRGB(.64,.65,.69);colors.setXYZ(i,color.r,color.g,color.b);}colors.needsUpdate=true;}
        }
        renderer.render(scene,camera);if(now-last>800){setStats(`${40/(2**level)} m geometric posts · ${[...meshes.values()].filter(t=>t.visible).length} visible tiles · ${(bytes/1048576).toFixed(2)} MiB loaded · ${renderer.info.render.triangles.toLocaleString()} triangles`);last=now;}
      }raf=requestAnimationFrame(draw);
      cleanup=()=>{cancelAnimationFrame(raf);resize.disconnect();controls.dispose();renderer.domElement.removeEventListener('click',click);for(const mesh of meshes.values()){mesh.geometry.dispose();(mesh.material as T.Material).dispose();}line.geometry.dispose();(line.material as T.Material).dispose();renderer.dispose();renderer.domElement.remove();};
    }
    void start().catch(e=>{if(alive)setError((e as Error).message);});return()=>{alive=false;controller.abort();cleanup?.();};
  },[]);
  const distance=measure.length===2?Math.hypot(measure[1][0]-measure[0][0],measure[1][1]-measure[0][1]):null;
  return <section className="dyn-atlas"><div className="dyn-toolbar"><div><span className="eng-kicker">{localizeText("MEASURED LUNAR ATLAS / MONS MOUTON")}</span><h2>{localizeText("Geometry that refines as you approach")}</h2></div><select aria-label={localizeText("Measured atlas overlay")} value={layer} onChange={e=>setLayer(e.target.value)}><option value="surface">{localizeText("Measured surface")}</option><option value="slope">{localizeText("Mesh slope · 0–40°")}</option><option value="elevation">{localizeText("Elevation · ±700 m from regional mean")}</option></select><button onClick={()=>{settings.current.zoom++;}}>{localizeText("Approach terrain")}</button><button onClick={()=>{settings.current.zoom--;}}>{localizeText("Widen terrain view")}</button><button onClick={()=>{settings.current.grazing=!settings.current.grazing;}}>{localizeText("Change inspection light")}</button><button aria-pressed={settings.current.measure} onClick={()=>{settings.current.measure=!settings.current.measure;setStats(settings.current.measure?'Click two terrain points to measure':'Measurement disabled');}}>{localizeText("Measure two points")}</button></div>
    <div className="dyn-atlas-scene" ref={host}/><p className="dyn-readout">{localizeText(stats)}</p>{localizeText(error&&<p role="alert">{localizeText(error)}</p>)}
    {localizeText(distance!==null&&<div className="dyn-readout">{localizeText("Plan distance ")}{localizeText(distance.toFixed(2))}{localizeText(" m · height difference ")}{localizeText((measure[1][2]-measure[0][2]).toFixed(2))}{localizeText(" m · chord grade ")}{localizeText((Math.atan2(Math.abs(measure[1][2]-measure[0][2]),distance)*180/Math.PI).toFixed(2))}° <button onClick={()=>downloadJson({schema:'egiz.measured_survey',source:manifest?.site.source,localCRS:manifest?.site.local_crs,origin:manifest?.site.local_origin,reconstruction:manifest?.method,pointTiles:measureSources,pointsENU:measure,planDistanceM:distance,interpretation:'Two rendered measured-mesh intersections; not a surveyed field measurement'},'egiz-lunar-survey.json')}>{localizeText("Export measurement")}</button></div>)}
    {localizeText(manifest&&<div className="dyn-science-note"><ContextHelp label="Model & assumptions"><p>{localizeText(manifest.method)}{localizeText(" No texture displacement or synthetic surface detail is added. Lighting is an adjustable inspection light, not SPICE illumination.")}</p></ContextHelp><p>{localizeText(manifest.limits)}{localizeText(" Current atlas covers 4 × 4 km; wheel-contact experiments use a separately declared synthetic course.")}</p><a href={manifest.site.source.url} target="_blank" rel="noreferrer">{localizeText("NASA LOLA source / ")}{localizeText(manifest.sourceSha256.slice(0,16))}…</a></div>)}
  </section>;
}
