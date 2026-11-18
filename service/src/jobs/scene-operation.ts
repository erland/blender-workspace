import {z} from 'zod';
const xyz=z.tuple([z.number().finite().min(-100).max(100),z.number().finite().min(-100).max(100),z.number().finite().min(-100).max(100)]);
const scale=z.tuple([z.number().finite().min(0.01).max(100),z.number().finite().min(0.01).max(100),z.number().finite().min(0.01).max(100)]);
const rgb=z.tuple([z.number().finite().min(0).max(1),z.number().finite().min(0).max(1),z.number().finite().min(0).max(1)]);
const name=z.string().trim().min(1).max(100).regex(/^[^\x00-\x1f\/\\]+$/);
const objectId=z.string().uuid();
const target={name:name.optional(),objectId:objectId.optional()};
const oneTarget=(x:{name?:string;objectId?:string})=>Boolean(x.name)!==Boolean(x.objectId);
export const SingleSceneOperationSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('add_primitive'),name,primitive:z.enum(['cube','sphere','cylinder','cone','torus']),
   location:xyz.optional(),scale:scale.optional(),color:rgb.optional()}).strict(),
 z.object({kind:z.literal('set_transform'),...target,location:xyz.optional(),scale:scale.optional(),
   rotation:xyz.optional()}).strict().refine(oneTarget,'Specify exactly one object selector').refine(v=>v.location!==undefined||v.scale!==undefined||v.rotation!==undefined,
     'At least one transform is required'),
 z.object({kind:z.literal('set_color'),...target,color:rgb}).strict().refine(oneTarget,'Specify exactly one object selector'),
 z.object({kind:z.literal('delete_object'),...target}).strict().refine(oneTarget,'Specify exactly one object selector'),
 z.object({kind:z.literal('rename_object'),...target,newName:name}).strict().refine(oneTarget,'Specify exactly one object selector')
   .refine(v=>v.name===undefined||v.name!==v.newName,'Object name must change'),
 z.object({kind:z.literal('duplicate_object'),name,source:name.optional(),sourceId:objectId.optional(),
   location:xyz.optional(),scale:scale.optional(),rotation:xyz.optional()}).strict()
   .refine(v=>Boolean(v.source)!==Boolean(v.sourceId),'Specify exactly one source selector')
   .refine(v=>v.source===undefined||v.source!==v.name,'Duplicate target must be different from source'),
 z.object({kind:z.literal('set_parent'),...target,parentId:objectId.nullable()}).strict()
   .refine(oneTarget,'Specify exactly one child selector')
   .refine(v=>v.parentId===null||v.parentId!==v.objectId,'Object cannot parent itself')
]);
export const SceneOperationSchema=z.union([SingleSceneOperationSchema,
 z.object({kind:z.literal('batch'),operations:z.array(SingleSceneOperationSchema).min(1).max(20)}).strict()
]);
export type SceneOperation=z.infer<typeof SceneOperationSchema>;
export function isValidInitialSceneOperation(op:SceneOperation):boolean{
 return op.kind==='add_primitive'||(op.kind==='batch'&&op.operations[0]?.kind==='add_primitive');
}
export function parseSceneOperation(value:unknown):SceneOperation{return SceneOperationSchema.parse(value);}
