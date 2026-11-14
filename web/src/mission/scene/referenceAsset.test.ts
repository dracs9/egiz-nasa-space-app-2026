import { describe,it,expect } from 'vitest';
import * as T from 'three';
import { partitionInspection,fitReference,prepareReferenceMaterials } from './referenceAsset';
import { orbitalDisplayPosition,spacecraftCameraOffset,transportCameraOffset } from './orbitalView';
import { configuredParts,referenceForMode,orbitalReference,equipmentAsset,namedReferencePart } from '../modelCatalog';
import { disposeObject } from './mechanical';

const triangles=(root:T.Object3D)=>{let count=0;root.traverse(o=>{if(o instanceof T.Mesh)count+=(o.geometry.index?.count??o.geometry.getAttribute('position').count)/3;});return count;};
describe('reference inspection preserves actual source surfaces',()=>{
  it('bakes nested and mirrored transforms without changing world bounds, triangles, UVs or materials',()=>{
    const root=new T.Group(),parent=new T.Group();root.add(parent);parent.position.set(2,3,-4);parent.rotation.set(.2,.4,.1);parent.scale.set(-1.2,.8,1.4);
    const materials=Array.from({length:6},(_,i)=>new T.MeshStandardMaterial({color:new T.Color().setHSL(i/6,.5,.5)}));
    const source=new T.BoxGeometry(2,4,1,2,4,2),mesh=new T.Mesh(source,materials);parent.add(mesh);root.updateMatrixWorld(true);
    const before=new T.Box3().setFromObject(root),count=triangles(root),uv=source.getAttribute('uv');
    const uvSet=new Set(Array.from({length:uv.count},(_,i)=>`${uv.getX(i)},${uv.getY(i)}`));
    const inspection=partitionInspection(root,'launcher');const after=new T.Box3().setFromObject(inspection);
    expect(after.min.distanceTo(before.min)).toBeLessThan(1e-6);expect(after.max.distanceTo(before.max)).toBeLessThan(1e-6);expect(triangles(inspection)).toBe(count);
    const used=new Set<T.Material>();inspection.traverse(o=>{if(!(o instanceof T.Mesh))return;used.add(o.material as T.Material);const a=o.geometry.getAttribute('uv');for(let i=0;i<a.count;i++)expect(uvSet.has(`${a.getX(i)},${a.getY(i)}`)).toBe(true);
      const position=o.geometry.getAttribute('position'),normal=o.geometry.getAttribute('normal');
      // Baking a reflection must also repair triangle winding for correct front-face culling.
      for(let i=0;i<position.count;i+=3){const a=new T.Vector3().fromBufferAttribute(position,i),b=new T.Vector3().fromBufferAttribute(position,i+1),c=new T.Vector3().fromBufferAttribute(position,i+2),n=new T.Vector3().fromBufferAttribute(normal,i);expect(b.sub(a).cross(c.sub(a)).dot(n)).toBeGreaterThan(0);}
    });expect(used.size).toBe(6);disposeObject(inspection);
  });
  it('decodes normalized attributes and fits the display stage without inventing dimensions',()=>{
    const source=new T.BoxGeometry(1,2,1);const normal=source.getAttribute('normal');source.setAttribute('normal',new T.Int16BufferAttribute(Array.from(normal.array,n=>n*32767),3,true));
    const root=new T.Group();root.add(new T.Mesh(source,new T.MeshStandardMaterial()));const inspection=partitionInspection(root,'suit');fitReference(inspection,3.7);
    const box=new T.Box3().setFromObject(inspection);expect(box.min.y).toBeCloseTo(0);expect(box.getSize(new T.Vector3()).y).toBeCloseTo(3.7);expect(box.getCenter(new T.Vector3()).x).toBeCloseTo(0);
    inspection.traverse(o=>{if(o instanceof T.Mesh){const n=o.geometry.getAttribute('normal');for(let i=0;i<n.count;i++)expect(new T.Vector3().fromBufferAttribute(n,i).length()).toBeCloseTo(1);}});disposeObject(inspection);
  });
  it('rejects skinned sources instead of silently baking broken articulation',()=>{
    const root=new T.Group();root.add(new T.SkinnedMesh(new T.BoxGeometry(),new T.MeshBasicMaterial()));expect(()=>partitionInspection(root,'suit')).toThrow('skinned');disposeObject(root);
  });
  it('corrects the known EMU cloth transparency export while retaining its visor and maps',()=>{
    const root=new T.Group(),cloth=new T.MeshPhysicalMaterial({transmission:1,ior:1,color:'#dddddd'}),visor=new T.MeshPhysicalMaterial({transmission:.32});root.add(new T.Mesh(new T.BoxGeometry(),[cloth,visor]));
    prepareReferenceMaterials(root,'mro');expect(cloth.transmission).toBe(1);prepareReferenceMaterials(root,'emu');expect(cloth.transmission).toBe(0);expect(cloth.color.getHexString()).toBe('dddddd');expect(visor.transmission).toBe(.32);disposeObject(root);
  });
  it('keeps scenario-specific configured guides separate from historical references',()=>{
    expect(referenceForMode('descent')).toBe('apollo-lm');expect(referenceForMode('launch')).toBe('saturn-v');expect(referenceForMode('eva')).toBe('emu');
    expect(configuredParts('launch').map(p=>p.id)).toEqual(['engines','tanks','fairing']);expect(orbitalReference('mars')).toBe('mro');expect(orbitalReference('moon')).toBe('lro');expect(equipmentAsset('emu').inspectionRegions).toBe(true);expect(namedReferencePart('mro','solar_R','mro_proxy7')).toBe('solar');expect(namedReferencePart('mro','cover','mro_proxy7')).toBe('antenna');expect(namedReferencePart('lro','LRO-Dish','Layer_3')).toBe('antenna');expect(namedReferencePart('lro','Crater-flat-gold','Layer_0')).toBe('instruments');
  });
});
describe('recorded orbit camera',()=>{
  it('preserves inertial distance and basis without mutating recorded SI values',()=>{
    const p:[number,number,number]=[1000,2000,3000],before=[...p],display=orbitalDisplayPosition(p,1000);expect(display.toArray()).toEqual([1,3,-2]);expect(display.length()).toBeCloseTo(Math.hypot(...p)/1000);expect(p).toEqual(before);expect(()=>orbitalDisplayPosition(p,0)).toThrow('radius');
  });
  it('transports the camera outside the body throughout a complete orbit',()=>{
    let previous=new T.Vector3(1.12,0,0),offset=spacecraftCameraOffset(previous);const initialLength=offset.length(),radial=offset.dot(previous.clone().normalize());
    for(let degree=1;degree<=360;degree++){const a=degree*Math.PI/180,next=new T.Vector3(1.12*Math.cos(a),.3*Math.sin(a),1.08*Math.sin(a));offset=transportCameraOffset(offset,previous,next);expect(offset.length()).toBeCloseTo(initialLength,8);expect(offset.dot(next.clone().normalize())).toBeCloseTo(radial,8);expect(next.clone().add(offset).length()).toBeGreaterThan(1.025);previous=next;}
  });
  it('provides finite outward tracking offsets over equatorial and polar states',()=>{
    for(const p of [new T.Vector3(1.1,0,0),new T.Vector3(0,1.1,0),new T.Vector3(0,-1.1,0),new T.Vector3(-.7,.4,.9)]){const before=p.clone(),offset=spacecraftCameraOffset(p);expect(offset.toArray().every(Number.isFinite)).toBe(true);expect(p.clone().add(offset).length()).toBeGreaterThan(p.length());expect(p.equals(before)).toBe(true);expect(offset.length()).toBeLessThan(.5);}
  });
});
