import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { equipmentAsset,nasaPart,inspectionRegion,namedReferencePart,type EquipmentId,type EquipmentFamily,type EquipmentPartId } from '../modelCatalog';

export async function loadReferenceAsset(id:EquipmentId):Promise<T.Group>{
  const decoder=new DRACOLoader();decoder.setDecoderPath(`${import.meta.env.BASE_URL}vendor/draco/`);decoder.setDecoderConfig({type:'js'});decoder.setWorkerLimit(1);
  try {
    const gltf=await new GLTFLoader().setDRACOLoader(decoder).loadAsync(`${import.meta.env.BASE_URL}models/${equipmentAsset(id).file}`);
    prepareReferenceMaterials(gltf.scene,id);
    if(id==='perseverance')gltf.scene.traverse(object=>{const node=gltf.parser.associations.get(object)?.nodes;if(node!==undefined)object.userData.component=nasaPart(gltf.parser.json.nodes[node].name??'');});
    return gltf.scene;
  }finally{decoder.dispose();}
}

/** NASA's EMU export marks opaque cloth and hardware as fully transmissive (IOR 1).
 * Correct that display artifact; retain the partially transmissive visor and source colours/maps. */
export function prepareReferenceMaterials(root:T.Object3D,id:EquipmentId):void {
  if(id!=='emu')return;
  root.traverse(object=>{if(object instanceof T.Mesh)for(const material of Array.isArray(object.material)?object.material:[object.material]){
    if(material instanceof T.MeshPhysicalMaterial&&material.transmission>=.999){material.transmission=0;material.needsUpdate=true;}
  }});
}

/** Bake static inspection geometry without altering its silhouette, normals, UVs or source asset. */
export function partitionInspection(root:T.Object3D,family:EquipmentFamily,configured=false,asset?:EquipmentId):T.Group {
  root.traverse(object=>{if(object instanceof T.SkinnedMesh)throw Error('Static inspection cannot partition a skinned source');});
  root.updateMatrixWorld(true);const bounds=new T.Box3().setFromObject(root),size=bounds.getSize(new T.Vector3());
  if(!Number.isFinite(size.length())||size.length()<=0)throw Error('Invalid reference model bounds');
  const result=new T.Group(),groups=new Map<EquipmentPartId,T.Group>(),discard=new Set<T.BufferGeometry>();
  root.traverse(object=>{
    if(!(object instanceof T.Mesh))return;
    if(object instanceof T.SkinnedMesh)throw Error('Static inspection cannot partition a skinned source');
    const source:T.BufferGeometry=object.geometry,index=source.index,position=source.getAttribute('position'),centroid=new T.Vector3();
    const bins=new Map<string,{part:EquipmentPartId;material:T.Material;vertices:number[]}>();
    for(let i=0;i<(index?.count??position.count);i+=3){
      const vertices=[0,1,2].map(j=>index?index.getX(i+j):i+j);
      if(object.matrixWorld.determinant()<0)[vertices[1],vertices[2]]=[vertices[2],vertices[1]];
      centroid.set(0,0,0);for(const vertex of vertices)centroid.add(new T.Vector3().fromBufferAttribute(position,vertex).applyMatrix4(object.matrixWorld));
      centroid.multiplyScalar(1/3).sub(bounds.min);centroid.set(centroid.x/Math.max(size.x,1e-9),centroid.y/Math.max(size.y,1e-9),centroid.z/Math.max(size.z,1e-9));
      const materialIndex=source.groups.find(group=>i>=group.start&&i<group.start+group.count)?.materialIndex??0;
      const material=Array.isArray(object.material)?object.material[materialIndex]:object.material;
      const part=namedReferencePart(asset,material.name,`${object.name} ${object.parent?.name??''}`)??inspectionRegion(family,centroid.x,centroid.y,centroid.z,configured);
      const key=`${part}/${materialIndex}`,bin=bins.get(key)??{part,material,vertices:[] as number[]};bin.vertices.push(...vertices);bins.set(key,bin);
    }
    for(const {part:key,material,vertices}of bins.values()){
      const geometry=new T.BufferGeometry();
      for(const [name,attribute]of Object.entries(source.attributes) as [string,T.BufferAttribute|T.InterleavedBufferAttribute][]){
        const values=new Float32Array(vertices.length*attribute.itemSize);
        for(let i=0;i<vertices.length;i++)for(let j=0;j<attribute.itemSize;j++)values[i*attribute.itemSize+j]=attribute.getComponent(vertices[i],j);
        geometry.setAttribute(name,new T.BufferAttribute(values,attribute.itemSize));
      }
      geometry.applyMatrix4(object.matrixWorld);geometry.computeBoundingBox();geometry.computeBoundingSphere();
      // Preserve material groups as well as GLTFLoader's separate material primitives.
      const mesh=new T.Mesh(geometry,material);mesh.name=object.name||`${key} surface`;mesh.userData.component=key;
      let group=groups.get(key);if(!group){group=new T.Group();group.name=key;group.userData.component=key;groups.set(key,group);result.add(group);}group.add(mesh);
    }
    discard.add(source);
  });
  discard.forEach(g=>g.dispose());return result;
}

/** Reference inspection is normalized to a stage, never presented as measured CAD dimensions. */
export function fitReference(root:T.Object3D,span=3.7):void {
  root.updateMatrixWorld(true);const box=new T.Box3().setFromObject(root),size=box.getSize(new T.Vector3());
  const scale=span/Math.max(size.x,size.y,size.z);if(!Number.isFinite(scale)||scale<=0)throw Error('Empty reference model');
  root.scale.multiplyScalar(scale);root.updateMatrixWorld(true);const fitted=new T.Box3().setFromObject(root),center=fitted.getCenter(new T.Vector3());
  root.position.add(new T.Vector3(-center.x,-fitted.min.y,-center.z));root.updateMatrixWorld(true);
}
