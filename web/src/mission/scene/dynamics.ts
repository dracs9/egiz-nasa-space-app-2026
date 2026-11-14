// Native body poses are authoritative. Decorative engineering details attach to those bodies.
import * as T from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { makeVehicle } from './vehicles';
import { makeWheelVisual, disposeObject } from './mechanical';
import { orbitalReference } from '../modelCatalog';
import { orbitalDisplayPosition,spacecraftCameraOffset,transportCameraOffset } from './orbitalView';
import { recordedState, type DynamicsRun } from '../dynamics';

export function dynamicsScene(host:HTMLElement,run:DynamicsRun,onSelect:(name:string)=>void) {
  const renderer=new T.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(1.5,devicePixelRatio));
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap;
  renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.25;host.append(renderer.domElement);
  const scene=new T.Scene();scene.background=new T.Color('#10191b');
  const pmrem=new T.PMREMGenerator(renderer),room=new RoomEnvironment(),env=pmrem.fromScene(room,.04);
  scene.environment=env.texture;scene.environmentIntensity=.5;room.dispose();pmrem.dispose();
  const camera=new T.PerspectiveCamera(40,1,.05,2000);
  const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.maxPolarAngle=Math.PI*.49;
  const world=new T.Group();world.rotation.x=-Math.PI/2;scene.add(world);
  scene.add(new T.HemisphereLight('#c6d7de','#55432b',2));
  const sun=new T.DirectionalLight('#fff0d5',4);sun.position.set(8,15,-6);sun.castShadow=true;
  sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-15;sun.shadow.camera.right=15;sun.shadow.camera.top=15;sun.shadow.camera.bottom=-15;sun.shadow.normalBias=.03;scene.add(sun);
  const groups:T.Group[]=[],arrows:T.ArrowHelper[]=[];
  const materials=new Set<T.Material>();
  const metal=new T.MeshStandardMaterial({color:'#bbc4c5',metalness:.8,roughness:.3});
  const dark=new T.MeshStandardMaterial({color:'#1d2528',metalness:.5,roughness:.5});
  const gold=new T.MeshStandardMaterial({color:'#b69a68',metalness:.65,roughness:.45});
  const mesh=(parent:T.Object3D,geo:T.BufferGeometry,mat:T.Material,p:number[]=[0,0,0])=>{const m=new T.Mesh(geo,mat);m.position.set(p[0],p[1],p[2]);m.castShadow=true;m.receiveShadow=true;parent.add(m);materials.add(mat);return m;};
  const p=run.request;
  const orbit=p.kind==='orbit';
  let orbiter:T.Group|undefined;
  let previousOrbitTarget:T.Vector3|undefined;
  let referenceStatus:'loading'|'ready'|'error'='loading',orbitalCamera:'planet'|'spacecraft'='planet',cameraChanged=false;
  if(!orbit) {
    for(const name of run.bodyNames!){const g=new T.Group();g.name=name;g.userData.component=name;groups.push(g);world.add(g);}
    for(const g of run.geometry){
      if(g.body>=0&&run.bodyNames![g.body].startsWith("wheel"))continue; // Keep collision geometry in the record; render a detailed attached shell.
      const [a,b,c]=g.size;
      let geo:T.BufferGeometry;
      if(g.type===0)geo=new T.PlaneGeometry(a*2,b*2);
      else if(g.type===2)geo=new T.SphereGeometry(a,16,12);
      else if(g.type===3){geo=new T.CapsuleGeometry(a,b*2,6,16);geo.rotateX(Math.PI/2);}
      else if(g.type===5){geo=new T.CylinderGeometry(a,a,b*2,48);geo.rotateX(Math.PI/2);}
      else geo=new RoundedBoxGeometry(2*a,2*b,2*c,2,Math.min(a,b,c)*.12);
      const mat=new T.MeshStandardMaterial({color:new T.Color(g.rgba[0],g.rgba[1],g.rgba[2]),metalness:g.body<0?.05:.55,roughness:g.type===5?.65:.4});
      const m=mesh(g.body<0?world:groups[g.body],geo,mat,g.position);
      m.quaternion.set(g.quaternion[1],g.quaternion[2],g.quaternion[3],g.quaternion[0]);
    }
    // Retain the established reusable instrument deck, cameras, radiator, foil and wiring.
    // Convert the original Y-up/-Z-forward assembly into native X-forward/Z-up coordinates.
    const deck=makeVehicle('rover');
    const detachedGeometries=new Set<T.BufferGeometry>(),detachedMaterials=new Set<T.Material>();
    for(const object of [...deck.arms.map(a=>a.mesh),...deck.wheels.map(w=>w.steer)]) {
      object.removeFromParent();object.traverse(child=>{if(child instanceof T.Mesh){detachedGeometries.add(child.geometry);for(const m of Array.isArray(child.material)?child.material:[child.material])detachedMaterials.add(m);}});
    }
    deck.root.traverse(child=>{if(child instanceof T.Mesh){detachedGeometries.delete(child.geometry);for(const m of Array.isArray(child.material)?child.material:[child.material])detachedMaterials.delete(m);}});
    detachedGeometries.forEach(g=>g.dispose());detachedMaterials.forEach(m=>m.dispose());
    const adapter=new T.Group();adapter.rotation.set(Math.PI/2,0,Math.PI/2,'ZYX');
    // Explicit basis: old right X -> native -Y; old up Y -> native Z; old front -Z -> native X.
    const basis=new T.Matrix4().makeBasis(new T.Vector3(0,-1,0),new T.Vector3(0,0,1),new T.Vector3(-1,0,0));
    adapter.quaternion.setFromRotationMatrix(basis);
    deck.root.position.y=-1.05;
    deck.root.scale.set((p.trackWidth??2.58)/2.58,1,(p.wheelbase??2.24)/2.24);
    adapter.add(deck.root);groups[0].add(adapter);
    // Actual wheel bodies own hubs, fasteners and tread. Every detail rotates with solver pose.
    for(let i=0;i<6;i++){
      const wheel=groups[run.bodyNames!.indexOf(`wheel${i}`)];const r=p.wheelRadius??.41,w=p.wheelWidth??.33;
      const visual=makeWheelVisual(r,w);visual.rotation.z=Math.PI/2;wheel.add(visual);
      const knuckle=groups[run.bodyNames!.indexOf(`knuckle${i}`)];
      mesh(knuckle,new T.CylinderGeometry(.095,.095,.16,24),dark,[0,0,.1]).rotation.x=Math.PI/2;
      const arm=groups[run.bodyNames!.indexOf(`arm${i}`)];
      mesh(arm,new T.CylinderGeometry(.08,.08,.17,24),gold);
      // Machined pivot bearing, retaining ring and torsion-spring housing, rigidly attached.
      for(const side of [-1,1]){
        const bearing=mesh(arm,new T.TorusGeometry(.091,.018,8,32),metal,[0,side*.085,0]);bearing.rotation.x=Math.PI/2;
        for(let j=0;j<6;j++){const a=j*Math.PI/3;mesh(arm,new T.CylinderGeometry(.015,.015,.03,6),dark,[Math.cos(a)*.07,side*.095,Math.sin(a)*.07]);}
      }
      const coilPoints=Array.from({length:81},(_,j)=>{const a=j/80*Math.PI*8;return new T.Vector3(Math.cos(a)*.085,-.075+j/80*.15,Math.sin(a)*.085);});
      mesh(arm,new T.TubeGeometry(new T.CatmullRomCurve3(coilPoints),80,.008,6,false),metal);
      // Motor housing and gear cover belong to the steering knuckle, not the spinning tire.
      const side=i<3?-1:1;
      mesh(knuckle,new T.CylinderGeometry(.13,.13,.15,32),gold,[0,-side*(w/2+.07),0]);
      for(let j=0;j<8;j++)mesh(knuckle,new T.BoxGeometry(.02,.14,.018),metal,[(j-3.5)*.025,-side*(w/2+.07),.105]);
      const arrow=new T.ArrowHelper(new T.Vector3(0,0,1),new T.Vector3(),1,'#73d6b6',.12,.06);world.add(arrow);arrows.push(arrow);
    }
    const grid=new T.GridHelper(60,60,'#897750','#343a39');grid.rotation.x=Math.PI/2;grid.position.z=.008;world.add(grid);
    camera.position.set(7,5,8);controls.target.set(1,1,0);controls.minDistance=2;controls.maxDistance=65;
  } else {
    controls.maxPolarAngle=Math.PI;
    const sphere=mesh(world,new T.SphereGeometry(1,96,64),new T.MeshStandardMaterial({color:p.body==='mars'?'#b77e59':p.body==='moon'?'#a2a5a5':'#5085a0',roughness:.8}));
    sphere.name='central body';
    // Existing attributed NASA/USGS context imagery; never used as orbital geometry.
    new T.TextureLoader().load(`${import.meta.env.BASE_URL}textures/${p.body}-preview.jpg`,texture=>{if(!alive){texture.dispose();return;}texture.colorSpace=T.SRGBColorSpace;(sphere.material as T.MeshStandardMaterial).map=texture;(sphere.material as T.MeshStandardMaterial).color.set('#ffffff');(sphere.material as T.MeshStandardMaterial).needsUpdate=true;});
    const scale=run.metrics.radius;
    const points=run.states.map(s=>new T.Vector3(...s.position).divideScalar(scale));
    world.add(new T.Line(new T.BufferGeometry().setFromPoints(points),new T.LineBasicMaterial({color:'#d8b476'})));
    orbiter=new T.Group();world.add(orbiter);
    mesh(orbiter,new T.BoxGeometry(.045,.035,.035),gold);
    for(const side of [-1,1])mesh(orbiter,new T.BoxGeometry(.08,.004,.045),new T.MeshStandardMaterial({color:'#295787',metalness:.7,roughness:.3}),[side*.07,0,0]);
    const marker=orbiter;
    void import('./referenceAsset').then(async({loadReferenceAsset,fitReference})=>{
      const reference=await loadReferenceAsset(orbitalReference(p.body));
      if(!alive){disposeObject(reference);return;}
      fitReference(reference,.13);
      const center=new T.Box3().setFromObject(reference).getCenter(new T.Vector3());reference.position.sub(center);
      const adapter=new T.Group();adapter.rotation.x=Math.PI/2;adapter.add(reference);
      for(const child of [...marker.children]){child.removeFromParent();disposeObject(child);}
      marker.add(adapter);referenceStatus='ready';dirty=true;
    }).catch(()=>{if(alive)referenceStatus='error';});
    const halo=new T.Mesh(new T.SphereGeometry(1.014,64,32),new T.MeshBasicMaterial({color:'#b38b64',side:T.BackSide,transparent:true,opacity:.15}));world.add(halo);
    const axes=new T.AxesHelper(1.5);world.add(axes);
    camera.position.set(2.7,1.9,2.4);controls.target.set(0,0,0);controls.minDistance=1.1;controls.maxDistance=30;
  }
  // Batch each rigid component independently; preserve solver body hierarchy and picking.
  for(const group of groups){
    const batches=new Map<T.Material,T.Mesh[]>();
    for(const child of group.children)if(child instanceof T.Mesh&&!Array.isArray(child.material)){const list=batches.get(child.material)??[];list.push(child);batches.set(child.material,list);}
    for(const [mat,items] of batches){if(items.length<2)continue;const parts=items.map(m=>{m.updateMatrix();return (m.geometry.index?m.geometry.toNonIndexed():m.geometry.clone()).applyMatrix4(m.matrix);});const merged=mergeGeometries(parts);parts.forEach(g=>g.dispose());if(merged){mesh(group,merged,mat);items.forEach(m=>{m.removeFromParent();m.geometry.dispose();});}}
  }
  const ray=new T.Raycaster(),pointer=new T.Vector2();
  const pick=(e:PointerEvent)=>{const rect=renderer.domElement.getBoundingClientRect();pointer.set(2*(e.clientX-rect.left)/rect.width-1,1-2*(e.clientY-rect.top)/rect.height);ray.setFromCamera(pointer,camera);const hit=ray.intersectObjects(groups,true)[0];if(hit){let obj:T.Object3D|null=hit.object;while(obj&&!obj.userData.component)obj=obj.parent;if(obj)onSelect(obj.userData.component);}};
  renderer.domElement.addEventListener('pointerup',pick);
  const selection=new T.BoxHelper(new T.Object3D(),'#f5ce84');scene.add(selection);selection.visible=false;
  let time=0,explode=0,selected='',follow=true,forces=true,alive=true,dirty=true,last=performance.now(),frames=0,fps=0;
  const resize=new ResizeObserver(()=>{const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();dirty=true;});resize.observe(host);
  function draw(){if(!alive)return;requestAnimationFrame(draw);if(document.hidden||!host.clientWidth||!host.clientHeight)return;const changed=controls.update();if(!dirty&&!changed)return;const s=recordedState(run,time);
    if(orbit&&orbiter){
      orbiter.position.set(...s.position).divideScalar(run.metrics.radius);
      const target=orbitalDisplayPosition(s.position,run.metrics.radius);
      if(cameraChanged){
        controls.minDistance=orbitalCamera==='spacecraft'?.035:1.1;controls.maxDistance=orbitalCamera==='spacecraft'?1.8:30;
        if(orbitalCamera==='spacecraft'){controls.target.copy(target);camera.position.copy(target).add(spacecraftCameraOffset(target));}
        else {camera.position.set(2.7,1.9,2.4);controls.target.set(0,0,0);}
        cameraChanged=false;previousOrbitTarget=undefined;
      }
      if(orbitalCamera==='spacecraft'){const offset=transportCameraOffset(camera.position.clone().sub(controls.target),previousOrbitTarget??target,target);camera.position.copy(target).add(offset);controls.target.copy(target);previousOrbitTarget=target.clone();}
    }
    else {
      s.poses!.forEach((pose,i)=>{groups[i].position.set(pose[0],pose[1],pose[2]);groups[i].quaternion.set(pose[4],pose[5],pose[6],pose[3]);if(explode&&i>0){const wheel=Math.floor((i-1)/3);groups[i].position.y+= (wheel<3?-1:1)*explode*1.5;groups[i].position.z+=explode*((i-1)%3)*.35;}});
      s.wheels!.forEach((w,i)=>{const pose=s.poses![run.bodyNames!.indexOf(`wheel${i}`)];arrows[i].position.set(pose[0],pose[1],pose[2]);const direction=new T.Vector3(...w.normalVector);if(direction.lengthSq()>1e-12)arrows[i].setDirection(direction.normalize());arrows[i].setLength(Math.max(.02,Math.min(5,w.normalForce/(run.metrics.mass*({earth:9.80665,moon:1.62,mars:3.71}[p.body]))*6)),.12,.06);arrows[i].visible=forces&&!explode;});
      if(follow&&!explode){const next=new T.Vector3(s.position[0],s.position[2],-s.position[1]);const delta=next.clone().sub(controls.target);camera.position.add(delta);controls.target.copy(next);}
    }
    const group=groups.find(g=>g.name===selected);selection.visible=!!group;if(group){group.updateWorldMatrix(true,true);selection.setFromObject(group);}
    controls.update();renderer.render(scene,camera);dirty=false;frames++;const now=performance.now();if(now-last>500){fps=frames*1000/(now-last);frames=0;last=now;}
  }draw();
  return {update:(t:number,e:number,name:string,tracking:boolean,showForces:boolean,view:'planet'|'spacecraft'='planet')=>{if(t!==time||e!==explode||name!==selected||tracking!==follow||showForces!==forces||view!==orbitalCamera)dirty=true;time=t;explode=e;selected=name;follow=tracking;forces=showForces;if(view!==orbitalCamera){orbitalCamera=view;cameraChanged=true;}},stats:()=>({fps,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,referenceStatus}),dispose:()=>{alive=false;resize.disconnect();controls.dispose();renderer.domElement.removeEventListener('pointerup',pick);const geos=new Set<T.BufferGeometry>(),mats=new Set<T.Material>(),textures=new Set<T.Texture>();scene.traverse(o=>{if(o instanceof T.Mesh||o instanceof T.Line){geos.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material]){mats.add(m);for(const val of Object.values(m))if(val instanceof T.Texture)textures.add(val);}}});geos.forEach(g=>g.dispose());mats.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());env.dispose();sun.shadow.dispose();renderer.dispose();renderer.domElement.remove();}};
}
