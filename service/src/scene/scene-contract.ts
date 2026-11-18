import {readFile,stat} from 'node:fs/promises';
import {z} from 'zod';
import type {LocalArtifactStore} from '../storage/artifact-store.js';

const boundedName=z.string().min(1).max(512);
const numbers=z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]);
const transform=z.object({
  location:numbers,rotationEuler:numbers,scale:numbers
}).strict();
const sceneObject=z.object({
  name:boundedName,
  type:boundedName,
  parent:boundedName.nullable().optional(),
  materials:z.array(z.string().max(512)).max(256).default([]),
  bones:z.array(z.string().max(512)).max(2048).default([]),
  localTransform:transform.optional()
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
  for(const item of report.scene.objects){
    if(names.has(item.name))throw new Error('Duplicate scene object name');
    names.add(item.name);
  }
  return report.scene;
}
