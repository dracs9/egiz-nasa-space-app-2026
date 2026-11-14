import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadReferenceAsset,partitionInspection,fitReference } from './referenceAsset';
import { makeVehicle } from './vehicles';
import { disposeObject } from './mechanical';
import { equipmentAsset, referenceForMode, type EquipmentPartId, type EquipmentId } from '../modelCatalog';
import type { Scenario } from '../types';

export interface StudioOptions {
  host:HTMLDivElement; source:'nasa'|'egiz';scenario:Scenario;asset:EquipmentId;
  onReady(parts:{name:string;part:EquipmentPartId}[],triangles:number):void;
  onPick(part:EquipmentPartId,name?:string):void;onError(message:string):void;
  onProject(points:{id:EquipmentPartId;x:number;y:number;visible:boolean}[]):void;
}
/** Inspection only. No wall-clock motion, fake telemetry or dynamics in this studio. */
export function createModelStudio(o:StudioOptions) {
  const renderer=new T.WebGLRenderer({antialias:true});
  renderer.setPixelRatio(Math.min(2,devicePixelRatio));renderer.outputColorSpace=T.SRGBColorSpace;
  renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.9;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap;
  renderer.domElement.setAttribute('aria-label','Interactive equipment model');o.host.append(renderer.domElement);
  const scene=new T.Scene();scene.background=new T.Color('#111819');scene.fog=new T.Fog('#111819',12,35);
  const camera=new T.PerspectiveCamera(34,1,.02,300);
  const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.minDistance=.25;controls.maxDistance=20;
  controls.maxPolarAngle=Math.PI*.53;
  const pmrem=new T.PMREMGenerator(renderer),room=new RoomEnvironment(),environment=pmrem.fromScene(room,.04);
  scene.environment=environment.texture;scene.environmentIntensity=.65;room.dispose();pmrem.dispose();
  scene.add(new T.HemisphereLight('#c7e3ef','#252124',.9));
  const key=new T.DirectionalLight('#fff4e0',3);key.position.set(3,7,5);key.castShadow=true;
  key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-5,right:5,top:5,bottom:-5,near:.1,far:20});key.shadow.normalBias=.008;scene.add(key);
  const rim=new T.DirectionalLight('#86b8d9',2.1);rim.position.set(-5,3,-4);scene.add(rim);
  const floor=new T.Mesh(new T.PlaneGeometry(200,200),new T.MeshStandardMaterial({color:'#080e11',metalness:0,roughness:1,envMapIntensity:.08}));floor.rotation.x=-Math.PI/2;floor.position.y=-.018;floor.receiveShadow=true;scene.add(floor);
  const grid=new T.GridHelper(14,28,'#374448','#263236');grid.position.y=-.015;(grid.material as T.Material).transparent=true;(grid.material as T.Material).opacity=.4;scene.add(grid);
  const model=new T.Group();scene.add(model);
  const meshes:T.Mesh[]=[],roots:{object:T.Object3D;position:T.Vector3;part:EquipmentPartId;offset:T.Vector3}[]=[];
  const groups=new Map<EquipmentPartId,T.Mesh[]>();
  let alive=true,raf=0,lastProjection=0,selected:EquipmentPartId|null=null,selectedName='',xray=false,explode=0,dirty=true;
  let destination:T.Vector3|null=null,look:T.Vector3|null=null;
  const bounds=new T.Box3();
  const originals=new Map<T.Material,{opacity:number;transparent:boolean;depthWrite:boolean;color:T.Color|null;emissive:T.Color|null}>();
  function register(root:T.Object3D) {
    root.updateMatrixWorld(true);
    const initial=new T.Box3().setFromObject(root),center=initial.getCenter(new T.Vector3());
    root.position.x-=center.x;root.position.z-=center.z;root.position.y-=initial.min.y;
    model.add(root);root.updateMatrixWorld(true);
    // Move only whole top-level assemblies for the inspection offsets. Preserve their hierarchy.
    const fullBounds=new T.Box3().setFromObject(root),fullCenter=fullBounds.getCenter(new T.Vector3());
    for(const object of root.children){
      const center=new T.Box3().setFromObject(object).getCenter(new T.Vector3());
      const offset=center.clone().sub(fullCenter);if(offset.lengthSq()<.001)offset.set(.4,.8,.2);offset.normalize().multiplyScalar(.9);
      const localOffset=root.worldToLocal(center.clone().add(offset)).sub(root.worldToLocal(center.clone()));
      roots.push({object,position:object.position.clone(),part:(object.userData.component as EquipmentPartId)??'chassis',offset:localOffset});
    }
    const sourceMaterials=new Set<T.Material>();
    root.traverse(object=>{
      if(!(object instanceof T.Mesh))return;
      let ancestor:T.Object3D|null=object;
      while(ancestor&&!ancestor.userData.component)ancestor=ancestor.parent;
      const part=(ancestor?.userData.component as EquipmentPartId)??'chassis';object.userData.part=part;
      meshes.push(object);const list=groups.get(part)??[];list.push(object);groups.set(part,list);
      object.castShadow=true;object.receiveShadow=true;
      for(const m of Array.isArray(object.material)?object.material:[object.material])sourceMaterials.add(m);
      object.material=Array.isArray(object.material)?object.material.map(m=>m.clone()):object.material.clone();
      for(const m of Array.isArray(object.material)?object.material:[object.material]) {
        const standard=m as T.MeshStandardMaterial;
        originals.set(m,{opacity:m.opacity,transparent:m.transparent,depthWrite:m.depthWrite,color:standard.color?.clone()??null,emissive:standard.emissive?.clone()??null});
        if(standard.map)standard.map.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
      }
    });
    sourceMaterials.forEach(m=>m.dispose());
    bounds.setFromObject(model);reset();renderer.render(scene,camera);
    o.onReady(meshes.map(m=>({name:m.name||m.parent?.name||'Assembly',part:m.userData.part})),renderer.info.render.triangles);
    dirty=true;
  }
  if(o.source==='nasa')void loadReferenceAsset(o.asset).then(root=>{
    if(!alive){disposeObject(root);return;}
    const asset=equipmentAsset(o.asset);const prepared=asset.inspectionRegions?partitionInspection(root,asset.family,false,o.asset):root;
    fitReference(prepared);register(prepared);
  }).catch(error=>{if(alive)o.onError(error instanceof Error?error.message:'Model asset could not be loaded');});
  else {
    const root=makeVehicle(o.scenario.mode,o.scenario.rover.design).root;
    register(o.scenario.mode==='rover'?root:partitionInspection(root,equipmentAsset(referenceForMode(o.scenario.mode)).family,true));
  }
  function reset() {
    bounds.setFromObject(model);
    const size=bounds.getSize(new T.Vector3()),center=bounds.getCenter(new T.Vector3());
    const distance=size.length()*.55/Math.sin(T.MathUtils.degToRad(camera.fov*.5))/Math.min(1,camera.aspect);
    const view=o.source==='nasa'&&o.asset==='emu'?new T.Vector3(1,.38,-1.2):new T.Vector3(o.source==='nasa'?-1:1,.58,o.source==='nasa'?1.1:-1.1);
    controls.target.copy(center);camera.position.copy(center).add(view.normalize().multiplyScalar(distance));
    // Publish position, target and orientation together, even when the tab's RAF is throttled.
    destination=look=null;camera.updateProjectionMatrix();controls.update();camera.updateMatrixWorld(true);dirty=true;
  }
  function focus(part:EquipmentPartId,name='') {
    const items=groups.get(part)??[];const box=new T.Box3();
    items.filter(m=>!name||m.name===name).forEach(m=>box.expandByObject(m));if(box.isEmpty())return;
    const center=box.getCenter(new T.Vector3()),size=box.getSize(new T.Vector3());
    const view=camera.position.clone().sub(controls.target).normalize();
    look=center;destination=center.clone().add(view.multiplyScalar(Math.max(.5,size.length()*.48/Math.sin(T.MathUtils.degToRad(camera.fov*.5)))/Math.min(1,camera.aspect)));dirty=true;
  }
  function style() {
    for(const mesh of meshes)for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]) {
      const original=originals.get(material)!,m=material as T.MeshStandardMaterial;
      const active=mesh.userData.part===selected&&(!selectedName||mesh.name===selectedName);
      const faded=xray&&!!selected&&!active;
      m.opacity=faded ? .13 : original.opacity;m.transparent=faded||original.transparent;m.depthWrite=faded?false:original.depthWrite;
      if(m.emissive&&original.emissive)m.emissive.copy(original.emissive).add(active?new T.Color('#214940'):new T.Color(0));
      m.needsUpdate=true;
    }dirty=true;
  }
  const pointer=new T.Vector2(),ray=new T.Raycaster();let down:[number,number]=[0,0];
  const start=(e:PointerEvent)=>{down=[e.clientX,e.clientY];destination=look=null;};
  const pick=(e:PointerEvent)=>{if(Math.hypot(e.clientX-down[0],e.clientY-down[1])>5)return;
    const r=renderer.domElement.getBoundingClientRect();pointer.set(2*(e.clientX-r.left)/r.width-1,1-2*(e.clientY-r.top)/r.height);ray.setFromCamera(pointer,camera);
    const hit=ray.intersectObjects(meshes,false).find(h=>!xray||!selected||h.object.userData.part===selected);
    if(hit)o.onPick(hit.object.userData.part,hit.object.name);
  };
  renderer.domElement.addEventListener('pointerdown',start);renderer.domElement.addEventListener('pointerup',pick);
  const resize=new ResizeObserver(()=>{const w=o.host.clientWidth,h=o.host.clientHeight;if(!alive||!w||!h)return;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();if(meshes.length)reset();renderer.render(scene,camera);});resize.observe(o.host);
  const refresh=()=>{dirty=true;};controls.addEventListener('change',refresh);
  function draw(now:number){if(!alive)return;raf=requestAnimationFrame(draw);
    if(destination&&look){camera.position.lerp(destination,.12);controls.target.lerp(look,.12);dirty=true;if(camera.position.distanceTo(destination)<.005)destination=look=null;}
    const changed=controls.update();if(!document.hidden&&(dirty||changed)){renderer.render(scene,camera);dirty=false;}
    if(now-lastProjection>100&&meshes.length){lastProjection=now;
      o.onProject([...groups].map(([id,items])=>{const b=new T.Box3();items.forEach(m=>b.expandByObject(m));const p=b.getCenter(new T.Vector3()).project(camera);return{id,x:(p.x*.5+.5)*o.host.clientWidth,y:(-.5*p.y+.5)*o.host.clientHeight,visible:p.z>-1&&p.z<1&&Math.abs(p.x)<.95&&Math.abs(p.y)<.92};}));}
  }raf=requestAnimationFrame(draw);
  return {
    select(part:EquipmentPartId|null,name='',zoom=false){selected=part;selectedName=name;style();if(zoom&&part)focus(part,name);},
    xray(value:boolean){xray=value;style();},
    explode(value:number){explode=value;
      roots.forEach(r=>r.object.position.copy(r.position).addScaledVector(r.offset,explode));model.updateMatrixWorld(true);reset();dirty=true;},
    reset,
    dispose(){alive=false;cancelAnimationFrame(raf);resize.disconnect();controls.dispose();renderer.domElement.removeEventListener('pointerdown',start);renderer.domElement.removeEventListener('pointerup',pick);disposeObject(scene);originals.forEach((_,m)=>m.dispose());environment.dispose();key.shadow.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();},
  };
}
