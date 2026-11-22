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
// Snapshots never force a dependency-graph evaluation. These counts are
// measured on stored datablocks, not generated geometry or child hair.
const storedComplexity=z.object({
  source:z.literal('stored'),
  evaluated:z.literal(false),
  proceduralPotential:z.boolean(),
  modifiers:z.array(z.object({
    name:boundedName,type:boundedName,procedural:z.boolean()
  }).strict()).max(64),
  mesh:z.object({vertices:counter,edges:counter,faces:counter}).strict().optional(),
  hair:z.object({
    curveCount:counter,pointCount:counter,interpolatedCount:z.null()
  }).strict().optional(),
  splines:counter.optional(),
  points:counter.optional(),
}).strict().superRefine((value,ctx)=>{
  if(value.proceduralPotential!==value.modifiers.some(m=>m.procedural))
    ctx.addIssue({code:'custom',message:'Inconsistent procedural flag'});
});
const sceneObject=z.object({
  name:boundedName,
  objectId:z.string().uuid().optional(),
  type:boundedName,
  parent:boundedName.nullable().optional(),
  materials:z.array(z.string().max(512)).max(256).default([]),
  bones:z.array(z.string().max(512)).max(2048).default([]),
  localTransform:transform.optional(),
  geometry:geometry.optional(),
  complexity:storedComplexity.optional()
}).strip();
const color=z.tuple([z.number().finite().min(0).max(1),
  z.number().finite().min(0).max(1),z.number().finite().min(0).max(1)]);
const factor=z.number().finite().min(0).max(1);
const materialAsset=z.object({
  name:boundedName,baseColor:color,metallic:factor,roughness:factor,
  opacity:factor,emissionColor:color,emissionStrength:factor,
  usedBy:z.array(boundedName).max(512)
}).strict();
const sceneSchema=z.object({
  objects:z.array(sceneObject).max(10_000),
  materialLibrary:z.array(materialAsset).max(128).optional(),
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
  const complexityObjects=all.filter(o=>o.complexity!==undefined);
  const complexityMissing=all.length-complexityObjects.length;
  const complexity={
    available:complexityMissing===0 && all.length>0,
    partial:complexityMissing>0 && complexityObjects.length>0,
    objectsWithoutMetrics:complexityMissing,
    ...(complexityMissing>0?{reason:'Complexity metrics absent from one or more saved objects'}:{}),
    objects:complexityObjects.map(o=>({
      name:o.name,objectId:o.objectId,type:o.type,complexity:o.complexity!
    }))
  };
  const meshes=all.filter(o=>o.type==='MESH');
  const available=meshes.filter(o=>o.geometry!==undefined);
  const missing=meshes.length-available.length;
  return {
    available:missing===0 && meshes.length>0,
    partial:missing>0 && available.length>0,
    reason:missing>0?'Geometry metrics unavailable in one or more saved mesh reports':
      meshes.length===0?'No mesh objects in selection':undefined,
    meshCount:meshes.length,
    complexity,
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

/** Catalog is optional for older immutable revisions. No guessed assets. */
export function materialCatalog(scene:SceneDescription){
  const library=scene.materialLibrary;
  if(library===undefined)return {
    available:false,reason:'Material catalog is absent from this saved revision',
    materials:[] as z.infer<typeof materialAsset>[]
  };
  const usedNames=new Set<string>();
  for(const asset of library){
    if(usedNames.has(asset.name))throw new Error('Duplicate library material');
    usedNames.add(asset.name);
  }
  return {available:true,materials:library};
}


// Safe, bounded performance values saved with a completed owner-owned revision.
// Never return free-text worker logs or unchecked report fields.
const measuredSeconds=z.number().finite().min(0).max(3600);
const storedPerformance=z.object({
  timings:z.object({
    modelingSeconds:measuredSeconds,
    blendSaveSeconds:measuredSeconds,
    glbExportSeconds:measuredSeconds,
    inlineRenderSeconds:measuredSeconds.optional(),
  }).strict().optional(),
  execution:z.object({
    sandboxStartSeconds:measuredSeconds,
    blenderExecutionSeconds:measuredSeconds,
    artifactTransferSeconds:measuredSeconds,
    estimatedComputeUsd:z.number().finite().min(0).max(10),
    estimateNote:z.literal('Approximate elapsed compute, not a Modal invoice'),
  }).strict().optional(),
  inlineRender:z.object({
    format:z.literal('png'),
    status:z.enum(['available','unavailable']),
    engine:z.literal('CYCLES').optional(),
    width:z.literal(512).optional(),
    height:z.literal(512).optional(),
    samples:z.literal(16).optional(),
    framing:z.literal('auto-stored-bounds').optional(),
    reason:z.literal('render_failed').optional()
  }).strict().optional()
}).passthrough();

export async function inspectSavedPerformance(
  storage:Pick<LocalArtifactStore,'verifiedArtifactPath'>,
  projectId:string,revision:number){
  const filename=await storage.verifiedArtifactPath(projectId,revision,'scene.json');
  if((await stat(filename)).size>2*1024*1024)throw new Error('Scene report too large');
  const report=SceneReportSchema.parse(JSON.parse(await readFile(filename,'utf8')));
  const data=storedPerformance.parse(report);
  if(!data.timings&&!data.execution&&!data.inlineRender)return null;
  return {
    ...(data.timings?{timings:data.timings}:{}),
    ...(data.execution?{execution:data.execution}:{}),
    ...(data.inlineRender?{inlineRender:data.inlineRender}:{})
  };
}
