import {z} from 'zod';
const uuid=z.string().uuid();
const offset=z.tuple([z.number().finite().min(-100000).max(100000),
 z.number().finite().min(-100000).max(100000),
 z.number().finite().min(-100000).max(100000)]);
export const AssetSourceSchema=z.object({
 projectId:uuid,
 revision:z.number().int().min(1).max(99999999),
 offset:offset.optional()
}).strict();
export const AssetSourcesSchema=z.array(AssetSourceSchema).max(4);
export type AssetSource=z.infer<typeof AssetSourceSchema>;
export function parseAssetSources(input:unknown):AssetSource[]{
 const parsed=AssetSourcesSchema.parse(input??[]);
 const keys=parsed.map(x=>x.projectId.toLowerCase()+':'+x.revision);
 if(new Set(keys).size!==keys.length)
  throw new RangeError('Duplicate model source; use a separate source revision');
 return parsed.map(x=>({projectId:x.projectId.toLowerCase(),revision:x.revision,
  offset:x.offset??[0,0,0]}));
}
