import {z} from 'zod';
const xyz=z.tuple([z.number().finite().min(-100).max(100),z.number().finite().min(-100).max(100),z.number().finite().min(-100).max(100)]);
const scale=z.tuple([z.number().finite().min(0.01).max(100),z.number().finite().min(0.01).max(100),z.number().finite().min(0.01).max(100)]);
const rgb=z.tuple([z.number().finite().min(0).max(1),z.number().finite().min(0).max(1),z.number().finite().min(0).max(1)]);
const name=z.string().trim().min(1).max(100).regex(/^[^\x00-\x1f\/\\]+$/);
export const SceneOperationSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('add_primitive'),name,primitive:z.enum(['cube','sphere','cylinder','cone','torus']),
   location:xyz.optional(),scale:scale.optional(),color:rgb.optional()}).strict(),
 z.object({kind:z.literal('set_transform'),name,location:xyz.optional(),scale:scale.optional(),
   rotation:xyz.optional()}).strict().refine(v=>v.location!==undefined||v.scale!==undefined||v.rotation!==undefined,
     'At least one transform is required'),
 z.object({kind:z.literal('set_color'),name,color:rgb}).strict(),
 z.object({kind:z.literal('delete_object'),name}).strict()
]);
export type SceneOperation=z.infer<typeof SceneOperationSchema>;
export function parseSceneOperation(value:unknown):SceneOperation{return SceneOperationSchema.parse(value);}
