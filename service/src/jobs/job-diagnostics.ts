/** Safe, finite failure vocabulary. Never persist or expose provider text or Python output. */
export const JOB_PHASES=['setup','modal_start','blender_execution','artifact_transfer',
  'artifact_validation','artifact_storage','revision_commit','cleanup'] as const;
export type JobPhase=typeof JOB_PHASES[number];
export const JOB_CODES=['initialization_failed','image_reference_invalid','modal_sdk_unavailable',
  'image_unavailable','authentication_failed',
  'sandbox_start_failed','blender_exit_nonzero','blender_execution_failed',
  'artifact_transfer_failed','artifact_invalid','artifact_storage_failed',
  'revision_commit_failed','sandbox_cleanup_failed','worker_timeout','worker_exit_nonzero',
  'worker_spawn_failed'] as const;
export type JobCode=typeof JOB_CODES[number];
const phases=new Set<string>(JOB_PHASES);
const codes=new Set<string>(JOB_CODES);
export const ARTIFACT_REASONS = [
  'blend_file_invalid','glb_file_invalid','report_file_invalid','blend_header_invalid',
  'glb_header_invalid','glb_length_invalid','glb_json_chunk_invalid','gltf_document_invalid',
  'glb_nodes_missing','glb_meshes_missing','glb_external_assets','report_provenance_invalid',
  'report_objects_invalid','object_name_invalid','object_id_invalid','object_id_duplicate',
  'report_artifact_list_invalid','artifact_checksum_mismatch','artifact_unclassified'
] as const;
export type ArtifactReason = typeof ARTIFACT_REASONS[number];
const reasons = new Set<string>(ARTIFACT_REASONS);
const PREFIX='BW_JOB_ERROR';
export class JobExecutionError extends Error {
  constructor(readonly phase:JobPhase,readonly code:JobCode,readonly reason?:ArtifactReason){
    super(`${PREFIX} phase=${phase} code=${code}${reason ? ' reason='+reason : ''}`);
    this.name='JobExecutionError';
  }
}
export function parseRunnerDiagnostic(output:string):JobExecutionError|null {
  // Full-line, short, strictly controlled protocol; never incorporate arbitrary stderr.
  const marker=/^BW_DIAGNOSTIC phase=([a-z_]+) code=([a-z_]+)(?: reason=([a-z_]+))?$/gm;
  let match:RegExpExecArray|null,last:JobExecutionError|null=null;
  while((match=marker.exec(output))!==null){
    if(phases.has(match[1])&&codes.has(match[2]))
      last=new JobExecutionError(match[1] as JobPhase,match[2] as JobCode,
        match[1]==='artifact_validation' && match[2]==='artifact_invalid' && reasons.has(match[3])
          ? match[3] as ArtifactReason : undefined);
  }
  return last;
}
export function safeStoredJobError(value:unknown):string {
  if(value instanceof JobExecutionError)return value.message;
  // Never serialize arbitrary errors (which may contain Modal tokens or file paths).
  return `${PREFIX} phase=setup code=initialization_failed`;
}
export function safeOwnerJobError(value:string|null|undefined):{phase:JobPhase;code:JobCode;reason?:ArtifactReason}|null {
  const m=/^BW_JOB_ERROR phase=([a-z_]+) code=([a-z_]+)(?: reason=([a-z_]+))?$/.exec(value??'');
  if(!m||!phases.has(m[1])||!codes.has(m[2]))return null;
  if(m[3] && !(m[1]==='artifact_validation' && m[2]==='artifact_invalid' && reasons.has(m[3])))return null;
  return {phase:m[1] as JobPhase,code:m[2] as JobCode,
    ...(m[3]?{reason:m[3] as ArtifactReason}:{})};
}
