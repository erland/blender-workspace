import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,writeFile,rm,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {ProjectRepository} from '../db/projects.js';
import type {LocalArtifactStore} from '../storage/artifact-store.js';

const exec=promisify(execFile);
const MAX_ARCHIVE_BYTES=128*1024*1024;
export interface ArchiveData {
  formatVersion:1;
  project:{originalId:string;name:string;description:string;currentRevision:number};
  revisions:{revision:number;note:string;createdAt:string;artifacts:
    {name:string;sizeBytes:number;sha256:string}[]}[];
}
export class ProjectArchiveService {
  constructor(private projects:Pick<ProjectRepository,
    'get'|'revisions'|'beginImport'|'finishImport'|'cancelImport'>,
    private artifacts:Pick<LocalArtifactStore,
      'archiveDirectory'|'inspect'|'publish'|'deleteProject'>){}
  private async run(mode:'import'|'export',source:string,projectDir:string,output:string){
    // Python is used only for ZIP byte processing. No Blender or user code executes.
    await exec('python3',[path.join(process.cwd(),'archive_tool.py'),mode,source,projectDir,output],
      {timeout:120000,maxBuffer:4096});
  }
  /** Caller must delete working directory after the response stream closes. */
  async export(owner:string,id:string):Promise<{archive:string;directory:string}>{
    const project=await this.projects.get(owner,id);
    if(!project)throw new RangeError('Project not found');
    const revisions=await this.projects.revisions(owner,id);
    if(project.current_revision!==revisions.length||revisions.length>99)
      throw new RangeError('Unsupported revision history');
    const metadata:ArchiveData={
      formatVersion:1,
      project:{originalId:id,name:project.name,description:project.description,
        currentRevision:project.current_revision},
      revisions:[],
    };
    for(let index=0;index<revisions.length;index++){
      const r=revisions[index];
      if(r.revision!==index+1||!r.artifact_prefix)throw new RangeError('Revision is incomplete');
      // Validates all SHA-256 hashes before the archive is issued.
      const manifest=await this.artifacts.inspect(id,r.revision,true);
      metadata.revisions.push({
        revision:r.revision,note:r.note,createdAt:new Date(r.created_at).toISOString(),
        artifacts:manifest.artifacts});
    }
    const directory=await mkdtemp(path.join(os.tmpdir(),'bw-export-'));
    const archive=path.join(directory,'project.bwproject.zip');
    try{
      const data=path.join(directory,'metadata.json');
      await writeFile(data,JSON.stringify(metadata),{mode:0o600});
      await this.run('export',data,this.artifacts.archiveDirectory(id),archive);
      const size=(await stat(archive)).size;
      if(size>MAX_ARCHIVE_BYTES)throw new RangeError('Archive is too large');
      return {archive,directory};
    }catch(error){await rm(directory,{force:true,recursive:true});throw error;}
  }
  async import(owner:string,archiveBytes:Buffer):Promise<string>{
    if(!Buffer.isBuffer(archiveBytes)||archiveBytes.length<22||
       archiveBytes.length>MAX_ARCHIVE_BYTES)throw new RangeError('Invalid archive size');
    const directory=await mkdtemp(path.join(os.tmpdir(),'bw-import-'));
    let createdId:string|undefined;
    try{
      const incoming=path.join(directory,'upload.zip');
      const output=path.join(directory,'contents');
      await writeFile(incoming,archiveBytes,{mode:0o600});
      await this.run('import',incoming,output,output);
      const data=JSON.parse(await readFile(path.join(output,'project.json'),'utf8')) as ArchiveData;
      // Python verified each member against project.json before anything is staged.
      const project=await this.projects.beginImport(owner,data.project.name,data.project.description);
      createdId=project.id;
      for(const r of data.revisions){
        await this.artifacts.publish({
          projectId:createdId,revision:r.revision,expectedPreviousRevision:r.revision-1,
          artifacts:r.artifacts.map(a=>({
            name:a.name,sourcePath:path.join(output,String(r.revision).padStart(8,'0'),a.name)
          }))
        });
      }
      await this.projects.finishImport(owner,createdId,
        data.revisions.map(r=>({revision:r.revision,note:r.note,createdAt:r.createdAt})));
      return createdId;
    }catch(error){
      if(createdId){
        try{
          await this.artifacts.deleteProject(createdId);
          await this.projects.cancelImport(owner,createdId);
        }catch{/* Leave hidden staged project for administrative recovery. */}
      }
      throw error;
    }finally{
      await rm(directory,{force:true,recursive:true});
    }
  }
}
