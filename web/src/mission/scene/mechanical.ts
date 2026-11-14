import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Original EGIZ open aluminium wheel. Local axle is X; outside radius is r. */
export function makeWheelVisual(r = .41, width = .33): T.Group {
  const root = new T.Group();
  root.userData.component = 'mobility';
  const aluminium = new T.MeshStandardMaterial({color:'#aeb9bd',metalness:.88,roughness:.34});
  const titanium = new T.MeshStandardMaterial({color:'#525d65',metalness:.82,roughness:.44});
  const hub = new T.MeshStandardMaterial({color:'#8c7956',metalness:.82,roughness:.32});
  const batches = new Map<T.Material,T.BufferGeometry[]>();
  function add(g:T.BufferGeometry,m:T.Material,x=0,y=0,z=0,axis?:T.Vector3,angle=0) {
    if(axis) g.applyMatrix4(new T.Matrix4().makeRotationAxis(axis,angle));
    g.translate(x,y,z);const items=batches.get(m)??[];items.push(g);batches.set(m,items);
  }
  const X=new T.Vector3(1,0,0),Z=new T.Vector3(0,0,1);
  // Open barrel with thin rolled sidewalls; no filled black tyre or solid end discs.
  add(new T.CylinderGeometry(r*.965,r*.965,width,64,1,true),titanium,0,0,0,Z,Math.PI/2);
  for(const side of [-1,1]) {
    for(const radius of [r*.90,r*.965]) add(new T.TorusGeometry(radius,r*.018,8,64),aluminium,side*width*.48,0,0,new T.Vector3(0,1,0),Math.PI/2);
    add(new T.CylinderGeometry(r*.205,r*.205,width*.28,32),hub,side*width*.45,0,0,Z,Math.PI/2);
    add(new T.CylinderGeometry(r*.12,r*.12,width*.08,32),titanium,side*width*.60,0,0,Z,Math.PI/2);
    for(let j=0;j<10;j++) {
      const a=j*Math.PI/5;
      const rib=new T.BoxGeometry(width*.055,r*.68,r*.065);
      rib.rotateX(a);add(rib,aluminium,side*width*.43,Math.cos(a)*r*.55,Math.sin(a)*r*.55);
      add(new T.CylinderGeometry(r*.023,r*.023,width*.035,6),aluminium,side*width*.61,Math.cos(a)*r*.165,Math.sin(a)*r*.165,Z,Math.PI/2);
    }
  }
  // Curved chevron grousers are integrated around the drum and respect its radius.
  for(let j=0;j<30;j++) {
    const angle=j*Math.PI*2/30;
    const points=Array.from({length:9},(_,i)=>{
      const u=i/8,theta=angle+(.5-Math.abs(u-.5))*.13;
      return new T.Vector3((u-.5)*width,Math.cos(theta)*r*.985,Math.sin(theta)*r*.985);
    });
    add(new T.TubeGeometry(new T.CatmullRomCurve3(points),12,r*.015,5,false),aluminium);
  }
  // Rolled inner stiffening hoops remain visible through the spokes.
  for(const side of [-1,1])add(new T.TorusGeometry(r*.7,r*.014,6,48),titanium,side*width*.35,0,0,new T.Vector3(0,1,0),Math.PI/2);
  for(const [m,parts] of batches) {
    const normalized=parts.map(g=>g.index?g.toNonIndexed():g.clone());
    const geometry=mergeGeometries(normalized)!; normalized.forEach(g=>g.dispose());parts.forEach(g=>g.dispose());
    const mesh=new T.Mesh(geometry,m);mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.component='mobility';root.add(mesh);
  }
  // Retain an explicit axis in metadata for adapters and regression verification.
  root.userData.axle=X.toArray();root.name='Open aluminium wheel';return root;
}

export function disposeObject(root:T.Object3D) {
  const geometries=new Set<T.BufferGeometry>(),materials=new Set<T.Material>(),textures=new Set<T.Texture>();
  root.traverse(o=>{if(o instanceof T.Mesh||o instanceof T.Line){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material]){materials.add(m);for(const v of Object.values(m))if(v instanceof T.Texture)textures.add(v);}}});
  geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());
}
