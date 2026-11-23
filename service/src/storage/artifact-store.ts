import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, open, readdir, readFile, rename, rm, stat, lstat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {ContentAddressedResourceStore} from './content-addressed-resources.js';
import type {StoredResource} from './content-addressed-resources.js';

export interface StoredArtifact {
  name: string;
  sizeBytes: number;
  sha256: string;
}
/** A stable logical resource path inside an isolated Blender workspace. */
export interface RevisionResource extends StoredResource {
  name:string;
}
export interface RevisionManifest {
  formatVersion: 1;
  projectId: string;
  revision: number;
  createdAt: string;
  artifacts: StoredArtifact[];
  resources?: RevisionResource[];
}
export interface IncomingArtifact {
  name: string;
  sourcePath: string;
}
export class RevisionConflictError extends Error {
  constructor(message: string) { super(message); this.name = 'RevisionConflictError'; }
}
const MAX_ARTIFACTS = 12;
const MAX_RESOURCES = 128;
const MAX_RESOURCE_PATH_LENGTH = 220;
const RESOURCE_SEGMENT = /^[a-zA-Z0-9_-]{1,80}$/;
const RESOURCE_EXTENSION = /^[a-zA-Z0-9]{1,12}$/;
/** A logical name must be portable and must never escape the isolated job. */
function resourceName(name:string):string {
  if(typeof name!=='string'||name.length<3||name.length>MAX_RESOURCE_PATH_LENGTH||name.includes('\\'))
    throw new RangeError('Invalid resource path');
  const components=name.split('/');
  if(components.length<2||components.length>4||components[0]!=='resources')
    throw new RangeError('Resource path must be within resources/');
  const leaf=components.at(-1)!;
  const dot=leaf.lastIndexOf('.');
  if(dot<1||!RESOURCE_SEGMENT.test(leaf.slice(0,dot))||
     !RESOURCE_EXTENSION.test(leaf.slice(dot+1))||
     components.slice(1,-1).some(v=>!RESOURCE_SEGMENT.test(v)))
    throw new RangeError('Invalid logical resource path');
  return name;
}
function checkedResources(value:unknown):RevisionResource[] {
  if(!Array.isArray(value)||value.length>MAX_RESOURCES)
    throw new RangeError('Invalid revision resources');
  const names=new Set<string>();
  return value.map((entry:unknown)=>{
    if(!entry||typeof entry!=='object'||Array.isArray(entry))
      throw new RangeError('Invalid resource descriptor');
    const r=entry as Record<string,unknown>;
    if(Object.keys(r).sort().join(',')!=='name,sha256,sizeBytes'||
       typeof r.name!=='string'||typeof r.sha256!=='string'||
       !/^[0-9a-f]{64}$/.test(r.sha256)||
       !Number.isSafeInteger(r.sizeBytes)||
       (r.sizeBytes as number)<1||(r.sizeBytes as number)>256*1024*1024)
      throw new RangeError('Invalid resource descriptor');
    resourceName(r.name);
    const key=r.name.toLowerCase();
    if(names.has(key))throw new RangeError('Duplicate logical resource path');
    names.add(key);
    return {name:r.name,sha256:r.sha256,sizeBytes:r.sizeBytes as number};
  });
}
const MAX_FILE_BYTES = 256 * 1024 * 1024;
const FILE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,80}\.(?:blend|glb|json|png)$/;
const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function projectId(value: string) {
  if (!PROJECT_ID.test(value)) throw new RangeError('Expected a project UUID');
  return value.toLowerCase();
}
function revision(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 99999999)
    throw new RangeError('Revision out of range');
  return value.toString().padStart(8, '0');
}
function artifactName(name: string) {
  if (!FILE_NAME.test(name) || name === 'manifest.json')
    throw new RangeError('Invalid artifact name');
  return name;
}
async function sha256(filename: string): Promise<string> {
  const hasher = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hasher.update(chunk);
  return hasher.digest('hex');
}
async function syncFile(filename: string) {
  const handle = await open(filename, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
async function syncDir(filename: string) {
  const handle = await open(filename, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
/** Local-volume ObjectStore for a single Coolify service instance.
 * Never exposes paths or accepts untrusted callers directly. Each published
 * revision is immutable, hash-verified and moved into place atomically.
 */
export class LocalArtifactStore {
  private readonly root: string;
  private readonly resources: ContentAddressedResourceStore;
  constructor(root: string) {
    if (!path.isAbsolute(root)) throw new RangeError('Storage root must be absolute');
    this.root = path.resolve(root);
    this.resources=new ContentAddressedResourceStore(this.root);
  }
  private directory(project: string) {
    return path.join(this.root, projectId(project));
  }
  private revisionDir(project: string, number: number) {
    return path.join(this.directory(project), revision(number));
  }
  /** Remove all artifacts for an already tombstoned project. Missing directories
   * count as success so interrupted deletion may be retried. Never accept a
   * filesystem path from the browser; the UUID determines the directory.
   */
  async deleteProject(project: string): Promise<void> {
    const directory = this.directory(project);
    try {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error('Unsafe project artifact directory');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    await rm(directory, { recursive: true, force: true });
  }
  /** Internal trusted caller only: validated source directory for archival. */
  archiveDirectory(project: string): string {return this.directory(project);}
  async listRevisions(project: string): Promise<number[]> {
    const directory = this.directory(project);
    let names: string[];
    try { names = await readdir(directory); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
    return names.filter(x => /^\d{8}$/.test(x))
      .map(Number).filter(x => x >= 1).sort((a,b) => a-b);
  }
  async publish(params: {
    projectId: string; revision: number; expectedPreviousRevision: number;
    artifacts: IncomingArtifact[];
    resources?:RevisionResource[];
  }): Promise<RevisionManifest> {
    const id = projectId(params.projectId);
    const key = revision(params.revision);
    if (!Number.isSafeInteger(params.expectedPreviousRevision) ||
        params.expectedPreviousRevision < 0 ||
        params.revision !== params.expectedPreviousRevision + 1)
      throw new RevisionConflictError('Revision does not follow expected predecessor');
    if (!Array.isArray(params.artifacts) || params.artifacts.length < 1 ||
        params.artifacts.length > MAX_ARTIFACTS)
      throw new RangeError('Invalid artifact count');
    const checked=checkedResources(params.resources??[]);
    // Revisions may reference existing immutable blobs only: all dependencies
    // must be present and hash verified before the revision is published.
    for(const resource of checked)await this.resources.verifiedPath(resource);
    const names = params.artifacts.map(x => artifactName(x.name));
    if (new Set(names).size !== names.length) throw new RangeError('Duplicate artifact name');
    const directory = this.directory(id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const lockFile = path.join(directory, '.publish.lock');
    let lock;
    try { lock = await open(lockFile, 'wx', 0o600); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST')
        throw new RevisionConflictError('Another publication is in progress');
      throw e;
    }
    let stage: string | undefined;
    try {
      const existing = await this.listRevisions(id);
      const last = existing.at(-1) ?? 0;
      if (last !== params.expectedPreviousRevision)
        throw new RevisionConflictError(`Expected revision ${params.expectedPreviousRevision}; actual ${last}`);
      stage = path.join(directory, '.staging-' + randomUUID());
      await mkdir(stage, { mode: 0o700 });
      const artifacts: StoredArtifact[] = [];
      for (const incoming of params.artifacts) {
        const info = await lstat(incoming.sourcePath);
        if (!info.isFile() || info.size < 1 || info.size > MAX_FILE_BYTES)
          throw new RangeError('Artifact must be a nonempty regular file <=256MiB');
        const destination = path.join(stage, incoming.name);
        await copyFile(incoming.sourcePath, destination);
        const copied = await stat(destination);
        if (copied.size !== info.size)
          throw new Error('Artifact changed during copy');
        await syncFile(destination);
        artifacts.push({ name: incoming.name, sizeBytes: copied.size, sha256: await sha256(destination) });
        if (await sha256(incoming.sourcePath) !== artifacts.at(-1)?.sha256)
          throw new Error('Artifact changed while publishing');
      }
      const manifest: RevisionManifest = {
        formatVersion: 1, projectId: id, revision: params.revision,
        createdAt: new Date().toISOString(), artifacts, resources:checked
      };
      await writeFile(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2)+'\n', { flag: 'wx', mode: 0o600 });
      await syncFile(path.join(stage, 'manifest.json'));
      await syncDir(stage);
      // Recheck right before publishing to fail closed if another process
      // has corrupted or removed an external resource while staging.
      for(const resource of checked)await this.resources.verifiedPath(resource);
      const final = path.join(directory, key);
      await rename(stage, final);
      stage = undefined;
      await syncDir(directory);
      return manifest;
    } finally {
      if (stage) await rm(stage, { recursive: true, force: true });
      await lock.close();
      await rm(lockFile, { force: true });
    }
  }
  async inspect(project: string, number: number, verifyBytes = true): Promise<RevisionManifest> {
    const id = projectId(project);
    const directory = this.revisionDir(id, number);
    const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8')) as RevisionManifest;
    if (manifest.formatVersion !== 1 || manifest.projectId !== id || manifest.revision !== number ||
        !Array.isArray(manifest.artifacts) || manifest.artifacts.length < 1 || manifest.artifacts.length > MAX_ARTIFACTS)
      throw new Error('Corrupt artifact manifest');
    const resources=checkedResources(manifest.resources??[]);
    const seen = new Set<string>();
    for (const artifact of manifest.artifacts) {
      artifactName(artifact.name);
      if (seen.has(artifact.name) || !Number.isSafeInteger(artifact.sizeBytes) ||
          artifact.sizeBytes < 1 || artifact.sizeBytes > MAX_FILE_BYTES ||
          !/^[0-9a-f]{64}$/.test(artifact.sha256))
        throw new Error('Invalid artifact metadata');
      seen.add(artifact.name);
      if (verifyBytes) {
        const p = path.join(directory, artifact.name);
        const info = await lstat(p);
        if (!info.isFile() || info.size !== artifact.sizeBytes || await sha256(p) !== artifact.sha256)
          throw new Error('Artifact checksum mismatch: ' + artifact.name);
      }
    }
    if(verifyBytes){
      for(const resource of resources)await this.resources.verifiedPath(resource);
    }
    return {...manifest,resources};
  }
  /** Resolve only resources belonging to an existing, verified revision.
   * An arbitrary user-provided hash is never sufficient authorization.
   * This internal API deliberately does not materialize arbitrary paths.
   */
  async verifiedRevisionResources(project:string,number:number):Promise<
    Array<{name:string;sha256:string;sizeBytes:number;path:string}>>{
    const manifest=await this.inspect(project,number,true);
    const result=[];
    for(const resource of manifest.resources??[]){
      result.push({...resource,path:await this.resources.verifiedPath(resource)});
    }
    return result;
  }
  /** Internal use only: validate entry against manifest before returning path. */
  /** Read only small immutable report bytes, verifying this artifact's SHA-256
   * without hashing potentially multi-hundred-MiB BLEND files on every page
   * view. Oversized or missing reports have unknown portability status.
   */
  async readVerifiedSmallArtifact(project: string, number: number, name: string,
    maxBytes = 4 * 1024 * 1024): Promise<string | null> {
    artifactName(name);
    if(name !== 'scene.json' || !Number.isSafeInteger(maxBytes) ||
       maxBytes < 1 || maxBytes > 4 * 1024 * 1024)
      throw new RangeError('Invalid small artifact request');
    const manifest = await this.inspect(project, number, false);
    const record = manifest.artifacts.find(a => a.name === name);
    if(!record || record.sizeBytes > maxBytes)return null;
    const filename = path.join(this.revisionDir(project, number), name);
    const info = await lstat(filename);
    if(!info.isFile() || info.isSymbolicLink() || info.size !== record.sizeBytes)
      throw new Error('Artifact metadata mismatch');
    const bytes = await readFile(filename);
    if(bytes.length !== record.sizeBytes ||
       createHash('sha256').update(bytes).digest('hex') !== record.sha256)
      throw new Error('Artifact checksum mismatch');
    return bytes.toString('utf8');
  }

  async verifiedArtifactPath(project: string, number: number, name: string): Promise<string> {
    artifactName(name);
    const manifest = await this.inspect(project, number);
    if (!manifest.artifacts.some(x => x.name === name))
      throw new Error('Artifact not found in revision');
    return path.join(this.revisionDir(project, number), name);
  }
}
