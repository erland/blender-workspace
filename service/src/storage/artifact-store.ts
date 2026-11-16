import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, open, readdir, readFile, rename, rm, stat, lstat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface StoredArtifact {
  name: string;
  sizeBytes: number;
  sha256: string;
}
export interface RevisionManifest {
  formatVersion: 1;
  projectId: string;
  revision: number;
  createdAt: string;
  artifacts: StoredArtifact[];
}
export interface IncomingArtifact {
  name: string;
  sourcePath: string;
}
export class RevisionConflictError extends Error {
  constructor(message: string) { super(message); this.name = 'RevisionConflictError'; }
}
const MAX_ARTIFACTS = 12;
const MAX_FILE_BYTES = 256 * 1024 * 1024;
const FILE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,80}\.(?:blend|glb|json)$/;
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
  constructor(root: string) {
    if (!path.isAbsolute(root)) throw new RangeError('Storage root must be absolute');
    this.root = path.resolve(root);
  }
  private directory(project: string) {
    return path.join(this.root, projectId(project));
  }
  private revisionDir(project: string, number: number) {
    return path.join(this.directory(project), revision(number));
  }
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
        createdAt: new Date().toISOString(), artifacts
      };
      await writeFile(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2)+'\n', { flag: 'wx', mode: 0o600 });
      await syncFile(path.join(stage, 'manifest.json'));
      await syncDir(stage);
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
    return manifest;
  }
  /** Internal use only: validate entry against manifest before returning path. */
  async verifiedArtifactPath(project: string, number: number, name: string): Promise<string> {
    artifactName(name);
    const manifest = await this.inspect(project, number);
    if (!manifest.artifacts.some(x => x.name === name))
      throw new Error('Artifact not found in revision');
    return path.join(this.revisionDir(project, number), name);
  }
}
