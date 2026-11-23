import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {LocalArtifactStore} from '../dist/storage/artifact-store.js';
import {buildPortableRevisionZip} from '../dist/jobs/portable-revision.js';

async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'bw-portable-zip-test-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const project=randomUUID(),revision=1;
 const scene=path.join(root,'native.blend'),texture=path.join(root,'original.png');
 const sceneBytes=Buffer.from('BLENDER-v400 immutable test source');
 const textureBytes=Buffer.concat([Buffer.from('PNG original pixels'),Buffer.alloc(128,17)]);
 await writeFile(scene,sceneBytes);
 await writeFile(texture,textureBytes);
 const artifacts=new LocalArtifactStore(root);
 const stored=await artifacts.storeResource(texture);
 const resource={name:'resources/'+stored.sha256+'.png',...stored};
 await artifacts.publish({projectId:project,revision,expectedPreviousRevision:0,
   artifacts:[{name:'scene.blend',sourcePath:scene}],resources:[resource]});
 return {root,project,revision,artifacts,scene,texture,sceneBytes,textureBytes,resource};
}
function inspectZip(zipFile){
 const py=`import json,sys,zipfile,hashlib
with zipfile.ZipFile(sys.argv[1]) as z:
 names=z.namelist()
 assert len(names)==len(set(names))
 data=json.loads(z.read('blender-workspace-resources.json'))
 assert all(hashlib.sha256(z.read(f['name'])).hexdigest()==f['sha256'] for f in data['revisionFiles'])
 print(json.dumps({'names':names,'manifest':data,'scene':z.read('scene.blend').hex()}))
`;
 return JSON.parse(execFileSync('python3',['-c',py,zipFile],{encoding:'utf8'}));
}

test('DEV-061 downloadable revision ZIP has exact BLEND and required images',async t=>{
 const f=await fixture(t);
 const result=await buildPortableRevisionZip(f.artifacts,f.project,f.revision);
 t.after(()=>rm(result.directory,{recursive:true,force:true}));
 const zip=inspectZip(result.archive);
 assert.deepEqual(zip.names.sort(),['README.txt','blender-workspace-resources.json',
   'scene.blend',f.resource.name].sort());
 assert.equal(Buffer.from(zip.scene,'hex').toString(),f.sceneBytes.toString());
 assert.equal(zip.manifest.revisionFiles.length,2);
 assert.deepEqual((await f.artifacts.inspect(f.project,1)).resources,[f.resource]);
 assert.deepEqual(await readFile(f.scene),f.sceneBytes,'must not repack or modify original');
});

test('DEV-061 missing or corrupt resource fails before ZIP is exposed',async t=>{
 const f=await fixture(t);
 const [found]=await f.artifacts.verifiedRevisionResources(f.project,1);
 await writeFile(found.path,Buffer.alloc(found.sizeBytes,0));
 await assert.rejects(()=>buildPortableRevisionZip(f.artifacts,f.project,1),
   /checksum|digest|mismatch/i);
});
test('DEV-061 unavailable BLEND cannot produce a supposedly portable ZIP',async t=>{
 const f=await fixture(t);
 const native=await f.artifacts.verifiedArtifactPath(f.project,1,'scene.blend');
 await writeFile(native,'corrupt bytes');
 await assert.rejects(()=>buildPortableRevisionZip(f.artifacts,f.project,1),/checksum|mismatch/i);
});
