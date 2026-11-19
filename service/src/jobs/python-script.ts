import {z} from 'zod';

/** Python is untrusted, executable content: never add this schema to
 * SceneOperationSchema or allow it to pass through the bounded operation tool.
 * Limit request size before persisting or executing in a per-job Modal Sandbox.
 */
export const PythonScriptSchema=z.object({
  kind:z.literal('python_script'),
  code:z.string().min(1).max(16_384).refine(x=>x.trim().length>0&&!x.includes('\0')&&Buffer.byteLength(x,'utf8')<=16_384,
    'Python source must be nonempty and contain no null bytes')
}).strict();
export type PythonScriptSpec=z.infer<typeof PythonScriptSchema>;
export function parsePythonScript(value:unknown):PythonScriptSpec{
  return PythonScriptSchema.parse(value);
}
