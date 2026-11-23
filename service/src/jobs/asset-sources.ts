import {z} from 'zod';
const uuid=z.string().uuid();
const offset=z.tuple([z.number().finite().min(-100000).max(100000),
 z.number().finite().min(-100000).max(100000),
 z.number().finite().min(-100000).max(100000)]);
const common={offset:offset.optional()};
export const TextureMappingSchema=z.object({
 objectName:z.string().trim().min(1).max(200),
 channel:z.enum(['baseColor','roughness','metallic','normal'])
}).strict();
export const AssetSourceSchema=z.union([
 z.object({projectId:uuid,revision:z.number().int().min(1).max(99999999),...common}).strict(),
 z.object({uploadId:uuid,...common}).strict(),
 z.object({uploadId:uuid,texture:TextureMappingSchema}).strict()
]);
export const AssetSourcesSchema=z.array(AssetSourceSchema).max(4);
export type AssetSource=z.infer<typeof AssetSourceSchema>;
export function parseAssetSources(input:unknown):AssetSource[]{
 const parsed=AssetSourcesSchema.parse(input??[]);
 const keys=parsed.map(x=>'uploadId' in x?'upload:'+x.uploadId.toLowerCase():
  'revision:'+x.projectId.toLowerCase()+':'+x.revision);
 if(new Set(keys).size!==keys.length)
  throw new RangeError('Duplicate model source');
 return parsed.map(x=>'uploadId' in x
   ?'texture' in x
     ?{uploadId:x.uploadId.toLowerCase(),texture:x.texture}
     :{uploadId:x.uploadId.toLowerCase(),offset:x.offset??[0,0,0]}
   :{projectId:x.projectId.toLowerCase(),revision:x.revision,offset:x.offset??[0,0,0]});
}
