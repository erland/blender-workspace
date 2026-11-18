import {z} from 'zod';
const xyz=z.tuple([z.number().finite().min(-100).max(100),z.number().finite().min(-100).max(100),z.number().finite().min(-100).max(100)]);
const scale=z.tuple([z.number().finite().min(0.01).max(100),z.number().finite().min(0.01).max(100),z.number().finite().min(0.01).max(100)]);
const rgb=z.tuple([z.number().finite().min(0).max(1),z.number().finite().min(0).max(1),z.number().finite().min(0).max(1)]);
const name=z.string().trim().min(1).max(100).regex(/^[^\x00-\x1f\/\\]+$/);
const objectId=z.string().uuid();
// Keep individual operations and 20-operation batches bounded within the MCP body limit.
const vertex=z.tuple([z.number().finite().min(-100).max(100),
  z.number().finite().min(-100).max(100),z.number().finite().min(-100).max(100)]);
const polygon=z.array(z.number().int().nonnegative()).min(3).max(8);
const verticesSchema=z.array(vertex).min(3).max(1024);
const facesSchema=z.array(polygon).min(1).max(2048);
const meshGeometry=z.object({
  vertices:verticesSchema,
  faces:facesSchema
}).strict().superRefine((mesh,ctx)=>{
  let total=0;
  for(const [i,face] of mesh.faces.entries()){
    total+=face.length;
    if(total>8192){ctx.addIssue({code:'custom',message:'Too many polygon indices'});break;}
    if(new Set(face).size!==face.length)
      ctx.addIssue({code:'custom',message:'Repeated polygon vertex',path:['faces',i]});
    if(face.some(index=>index>=mesh.vertices.length))
      ctx.addIssue({code:'custom',message:'Vertex index out of range',path:['faces',i]});
  }
});

const target={name:name.optional(),objectId:objectId.optional()};
const oneTarget=(x:{name?:string;objectId?:string})=>Boolean(x.name)!==Boolean(x.objectId);
export const SingleSceneOperationSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('add_primitive'),name,primitive:z.enum(['cube','sphere','cylinder','cone','torus']),
   location:xyz.optional(),scale:scale.optional(),color:rgb.optional()}).strict(),
 z.object({kind:z.literal('add_mesh'),name,vertices:verticesSchema,
   faces:facesSchema,location:xyz.optional(),scale:scale.optional(),
   rotation:xyz.optional(),color:rgb.optional()}).strict().superRefine((mesh,ctx)=>{
     const result=meshGeometry.safeParse({vertices:mesh.vertices,faces:mesh.faces});
     if(!result.success)for(const issue of result.error.issues)
       ctx.addIssue({code:'custom',message:issue.message,path:issue.path});
   }),
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
 z.object({kind:z.literal('bevel_mesh'),...target,
   width:z.number().finite().min(0.001).max(2),
   segments:z.number().int().min(1).max(3)}).strict()
   .refine(oneTarget,'Specify exactly one mesh selector'),
 z.object({kind:z.literal('subdivide_mesh'),...target,
   levels:z.number().int().min(1).max(2)}).strict()
   .refine(oneTarget,'Specify exactly one mesh selector'),
 z.object({kind:z.literal('boolean_mesh'),...target,operandId:objectId,
   operation:z.enum(['union','difference','intersection'])}).strict()
   .refine(oneTarget,'Specify exactly one target mesh selector')
   .refine(v=>v.objectId===undefined||v.objectId!==v.operandId,
     'Target and operand must differ'),
 z.object({kind:z.literal('extrude_face'),...target,
   faceIndex:z.number().int().min(0).max(39999),
   offset:z.tuple([z.number().finite().min(-10).max(10),z.number().finite().min(-10).max(10),z.number().finite().min(-10).max(10)])}).strict()
   .refine(oneTarget,'Specify exactly one mesh selector')
   .refine(v=>v.offset.some(n=>n!==0),'Extrusion offset must be nonzero'),
 z.object({kind:z.literal('mirror_mesh'),...target,axis:z.enum(['x','y','z'])}).strict()
   .refine(oneTarget,'Specify exactly one mesh selector'),
 z.object({kind:z.literal('array_mesh'),...target,count:z.number().int().min(2).max(8),
   offset:z.tuple([z.number().finite().min(-10).max(10),z.number().finite().min(-10).max(10),z.number().finite().min(-10).max(10)])}).strict()
   .refine(oneTarget,'Specify exactly one mesh selector')
   .refine(v=>v.offset.some(n=>n!==0),'Array offset must be nonzero'),
 z.object({kind:z.literal('set_parent'),...target,parentId:objectId.nullable()}).strict()
   .refine(oneTarget,'Specify exactly one child selector')
   .refine(v=>v.parentId===null||v.parentId!==v.objectId,'Object cannot parent itself')
]);
export const SceneOperationSchema=z.union([SingleSceneOperationSchema,
 z.object({kind:z.literal('batch'),operations:z.array(SingleSceneOperationSchema).min(1).max(20)}).strict()
]);
export type SceneOperation=z.infer<typeof SceneOperationSchema>;
export function isValidInitialSceneOperation(op:SceneOperation):boolean{
 return op.kind==='add_primitive'||op.kind==='add_mesh'||(op.kind==='batch'&&
   (op.operations[0]?.kind==='add_primitive'||op.operations[0]?.kind==='add_mesh'));
}
export function parseSceneOperation(value:unknown):SceneOperation{return SceneOperationSchema.parse(value);}
