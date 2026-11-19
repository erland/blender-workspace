/** Safe, finite failure vocabulary. Never persist or expose provider text or Python output. */
export const JOB_PHASES=['setup','modal_start','blender_execution','artifact_transfer',
  'artifact_validation','artifact_storage','revision_commit','cleanup'] as const;
export type JobPhase=typeof JOB_PHASES[number];
export const JOB_CODES=['initialization_failed','image_unavailable','authentication_failed',
  'sandbox_start_failed','blender_exit_nonzero','blender_execution_failed',
  'artifact_transfer_failed','artifact_invalid','artifact_storage_failed',
  'revision_commit_failed','sandbox_cleanup_failed','worker_timeout','worker_exit_nonzero',
  'worker_spawn_failed'] as const;
export type JobCode=typeof JOB_CODES[number];
const phases=new Set<string>(JOB_PHASES);
const codes=new Set<string>(JOB_CODES);
const PREFIX='BW_JOB_ERROR';
export class JobExecutionError extends Error {
  constructor(readonly phase:JobPhase,readonly code:JobCode){
    super(`${PREFIX} phase=${phase} code=${code}`);
    this.name='JobExecutionError';
  }
}
export function parseRunnerDiagnostic(output:string):JobExecutionError|null {
  // Full-line, short, strictly controlled protocol; never incorporate arbitrary stderr.
  const marker=/^BW_DIAGNOSTIC phase=([a-z_]+) code=([a-z_]+)$/gm;
  let match:RegExpExecArray|null,last:JobExecutionError|null=null;
  while((match=marker.exec(output))!==null){
    if(phases.has(match[1])&&codes.has(match[2]))
      last=new JobExecutionError(match[1] as JobPhase,match[2] as JobCode);
  }
  return last;
}
export function safeStoredJobError(value:unknown):string {
  if(value instanceof JobExecutionError)return value.message;
  // Never serialize arbitrary errors (which may contain Modal tokens or file paths).
  return `${PREFIX} phase=setup code=initialization_failed`;
}
export function safeOwnerJobError(value:string|null|undefined):{phase:JobPhase;code:JobCode}|null {
  const m=/^BW_JOB_ERROR phase=([a-z_]+) code=([a-z_]+)$/.exec(value??'');
  if(!m||!phases.has(m[1])||!codes.has(m[2]))return null;
  return {phase:m[1] as JobPhase,code:m[2] as JobCode};
}
