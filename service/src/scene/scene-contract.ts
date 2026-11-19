import {readFile,stat} from 'node:fs/promises';
import {z} from 'zod';
import type {LocalArtifactStore} from '../storage/artifact-store.js';

const boundedName=z.string().min(1).max(512);
const numbers=z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]);
const transform=z.object({
  location:numbers,rotationEuler:numbers,scale:numbers
}).strict();
const counter=z.number().int().nonnegative().max(1_000_000_000);
const geometry=z.object({
  vertexCount:counter,edgeCount:counter,faceCount:counter,triangleCount:counter,
  uvLayerCount:counter,
  modifiers:z.array(z.object({name:boundedName,type:boundedName}).strict()).max(64),
  worldBounds:z.object({min:numbers,max:numbers,dimensions:numbers}).strict(),
  qualityChecks:z.object({
    boundaryEdges:counter,nonManifoldEdges:counter,looseEdges:counter,
    isolatedVertices:counter,degenerateFaces:counter
  }).strict(),
  warnings:z.array(z.object({
    code:z.enum(['open_boundaries','non_manifold_edges','loose_edges',
      'isolated_vertices','degenerate_faces','no_faces']),count:counter
  }).strict()).max(6)
}).strict().superRefine((m,ctx)=>{
  for(let axis=0;axis<3;axis++){
    if(m.worldBounds.max[axis]<m.worldBounds.min[axis]||
       Math.abs((m.worldBounds.max[axis]-m.worldBounds.min[axis])-m.worldBounds.dimensions[axis])>0.0001)
      ctx.addIssue({code:'custom',message:'Inconsistent world bounds',path:['worldBounds']});
  }
  if(m.qualityChecks.boundaryEdges+m.qualityChecks.nonManifoldEdges+
     m.qualityChecks.looseEdges>m.edgeCount)
    ctx.addIssue({code:'custom',message:'Invalid edge diagnostics'});
  if(m.qualityChecks.isolatedVertices>m.vertexCount||m.qualityChecks.degenerateFaces>m.faceCount)
    ctx.addIssue({code:'custom',message:'Invalid mesh diagnostics'});
});
export type GeometryDescription=z.infer<typeof geometry>;
const sceneObject=z.object({
  name:boundedName,
  objectId:z.string().uuid().optional(),
  type:boundedName,
  parent:boundedName.nullable().optional(),
  materials:z.array(z.string().max(512)).max(256).default([]),
  bones:z.array(z.string().max(512)).max(2048).default([]),
  localTransform:transform.optional(),
  geometry:geometry.optional()
}).strip();
const sceneSchema=z.object({
  objects:z.array(sceneObject).max(10_000),
  blender_version:z.string().max(128).optional(),
  fps:z.number().finite().nonnegative().optional(),
  frame_start:z.number().int().optional(),
  frame_end:z.number().int().optional(),
  actions:z.array(z.string().max(512)).max(4096).optional(),
  render_engine:z.string().max(128).optional()
}).strip();
const reportSchema=z.object({
  schema_version:z.literal(1),scene:sceneSchema
}).passthrough();
export type SceneDescription=z.infer<typeof sceneSchema>;
export type SceneObject=z.infer<typeof sceneObject>;
export const SceneDescriptionSchema=sceneSchema;
export const SceneReportSchema=reportSchema;

/** Never infer object identifiers from the project name or from demo conventions.
 * Read one structured JSON scene report already saved with an immutable revision.
 * Existing (DEV-001–012) reports contain the same scene.objects envelope.
 */
export async function inspectSavedScene(
  storage:Pick<LocalArtifactStore,'inspect'|'verifiedArtifactPath'>,
  projectId:string,revision:number):Promise<SceneDescription>{
  const manifest=await storage.inspect(projectId,revision,true);
  const reports=manifest.artifacts.filter(x=>x.name.endsWith('.json'));
  if(reports.length!==1)throw new Error('Exactly one scene report is required');
  if(reports[0].sizeBytes>2*1024*1024)
    throw new Error('Scene report too large to inspect');
  const filepath=await storage.verifiedArtifactPath(projectId,revision,reports[0].name);
  const size=await stat(filepath);
  if(size.size>2*1024*1024)throw new Error('Scene report too large to inspect');
  const report=SceneReportSchema.parse(JSON.parse(await readFile(filepath,'utf8')));
  const names=new Set<string>();
  const ids=new Set<string>();
  for(const item of report.scene.objects){
    if(names.has(item.name))throw new Error('Duplicate scene object name');
    names.add(item.name);
    if(item.objectId){
      if(ids.has(item.objectId))throw new Error('Duplicate scene object ID');
      ids.add(item.objectId);
    }
  }
  return report.scene;
}

/** Geometry is optional in historic immutable reports. Never fabricate it. */
export function geometrySnapshot(scene:SceneDescription,objectId?:string){
  const all=objectId?scene.objects.filter(o=>o.objectId===objectId):scene.objects;
  if(objectId&&all.length===0)throw new Error('Object ID not found in revision');
  const meshes=all.filter(o=>o.type==='MESH');
  const available=meshes.filter(o=>o.geometry!==undefined);
  const missing=meshes.length-available.length;
  return {
    available:missing===0 && meshes.length>0,
    partial:missing>0 && available.length>0,
    reason:missing>0?'Geometry metrics unavailable in one or more saved mesh reports':
      meshes.length===0?'No mesh objects in selection':undefined,
    meshCount:meshes.length,
    meshesWithoutMetrics:missing,
    objects:available.map(o=>({name:o.name,objectId:o.objectId,geometry:o.geometry!}))
  };
}

export function geometryValidation(scene:SceneDescription,objectId?:string){
  const snapshot=geometrySnapshot(scene,objectId);
  const findings=snapshot.objects.flatMap(o=>o.geometry.warnings.map(w=>({
    name:o.name,objectId:o.objectId,code:w.code,count:w.count,
    severity:'warning' as const
  })));
  return {
    available:snapshot.available,partial:snapshot.partial,
    reason:snapshot.reason,
    checkedMeshes:snapshot.objects.length,
    meshesWithoutMetrics:snapshot.meshesWithoutMetrics,
    status:!snapshot.available?'incomplete':findings.length?'warnings':'no_warnings',
    findings,
    note:'Diagnostic snapshot of base mesh topology only; not a proof of watertightness, printable geometry, evaluated modifiers or export readiness'
  };
}
