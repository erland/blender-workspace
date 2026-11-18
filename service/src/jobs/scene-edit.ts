import {z} from 'zod';
/** Strict data-only scene edit; Blender script is fixed and never supplied by users. */
const vector=z.tuple([z.number().finite().min(-10).max(10),
  z.number().finite().min(-10).max(10),z.number().finite().min(-10).max(10)]);
const color=z.tuple([z.number().finite().min(0).max(1),
  z.number().finite().min(0).max(1),z.number().finite().min(0).max(1)]);
/** Names are intentionally fixed to meshes present in create_monster.py. */
export const EDITABLE_PARTS=["Body","LeftLeg","RightLeg","LeftEye","RightEye","LeftPupil","RightPupil"] as const;
export const SceneEditSchema=z.object({
  target:z.enum(["Body","LeftLeg","RightLeg","LeftEye","RightEye","LeftPupil","RightPupil"]),
  color:color.optional(),
  location:vector.optional(),
  scale:z.tuple([z.number().finite().min(0.1).max(4),
    z.number().finite().min(0.1).max(4),z.number().finite().min(0.1).max(4)]).optional()
}).strict().refine(x=>x.color!==undefined||x.location!==undefined||x.scale!==undefined,
  'At least one change is required');
export type SceneEdit=z.infer<typeof SceneEditSchema>;
export function parseSceneEdit(value:unknown):SceneEdit{return SceneEditSchema.parse(value);}
export const LEGACY_BLUE_EDIT:SceneEdit={target:'Body',color:[0.10,0.26,0.90]};
