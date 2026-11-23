"""Build a portable, revision-specific Blender ZIP from verified private paths.

No Blender/Modal execution. All member names come from trusted revision
manifest (not ZIP input), and we independently recheck bytes on disk.
"""
import hashlib
import json
import pathlib
import re
import stat
import sys
import zipfile

RESOURCE = re.compile(r'^resources/[A-Za-z0-9_-]{1,80}(?:/[A-Za-z0-9_-]{1,80}){0,2}/?[A-Za-z0-9_-]{1,80}\.[A-Za-z0-9]{1,12}$')
SHA = re.compile(r'^[a-f0-9]{64}$')
MAX_BYTES = 1024 * 1024 * 1024

def verified(source, expected, size):
    p = pathlib.Path(source)
    if not p.is_absolute() or p.is_symlink() or not p.is_file():
        raise ValueError('Unsafe source file')
    info = p.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_size != size:
        raise ValueError('Resource size mismatch')
    digest=hashlib.sha256()
    with p.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):
            digest.update(chunk)
    if digest.hexdigest()!=expected:
        raise ValueError('Resource digest mismatch')
    return p

def build(spec_file,output):
    config_file=pathlib.Path(spec_file)
    if config_file.is_symlink() or not config_file.is_file() or config_file.stat().st_size>65536:
        raise ValueError('Invalid packaging request')
    spec=json.loads(config_file.read_text('utf8'))
    if not isinstance(spec,dict) or set(spec)!={'blend','resources'}:
        raise ValueError('Invalid packaging descriptor')
    scene=spec['blend']
    resources=spec['resources']
    if not isinstance(scene,dict) or set(scene)!={'path','sha256','sizeBytes'}:
        raise ValueError('Invalid scene descriptor')
    if not isinstance(resources,list) or len(resources)>128:
        raise ValueError('Invalid resource list')
    all_files=[('scene.blend',scene)]
    seen={'scene.blend'}
    for item in resources:
        if not isinstance(item,dict) or set(item)!={'name','path','sha256','sizeBytes'}:
            raise ValueError('Invalid resource descriptor')
        name=item['name']
        if not isinstance(name,str) or not RESOURCE.fullmatch(name) or name.lower() in seen:
            raise ValueError('Unsafe resource name')
        seen.add(name.lower())
        all_files.append((name,item))
    total=0
    entries=[]
    for name,item in all_files:
        sha=item['sha256']
        size=item['sizeBytes']
        if not isinstance(sha,str) or not SHA.fullmatch(sha) or type(size)!=int or not 1<=size<=256*1024*1024:
            raise ValueError('Invalid integrity metadata')
        total+=size
        if total>MAX_BYTES:raise ValueError('Archive input budget exceeded')
        file=verified(item['path'],sha,size)
        entries.append((name,file,sha,size))
    manifest={'formatVersion':1,'revisionFiles':[{'name':n,'sha256':sha,'sizeBytes':size}
                                                 for n,_,sha,size in entries]}
    output_file=pathlib.Path(output)
    with zipfile.ZipFile(output_file,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=6,
                         allowZip64=False) as archive:
        for name,file,sha,size in entries:
            # Verify again immediately before streaming each member.
            verified(str(file),sha,size)
            archive.write(file,name)
        archive.writestr('blender-workspace-resources.json',
                         json.dumps(manifest,sort_keys=True,indent=2)+'\n')
        archive.writestr('README.txt',
                         'Extract the entire ZIP into one directory. Open scene.blend in Blender.\n'
                         'Keep the resources/ subdirectory beside scene.blend.\n'
                         'The BLEND and resource hashes are recorded in blender-workspace-resources.json.\n')
    if output_file.stat().st_size>256*1024*1024:
        raise ValueError('Archive exceeds download limit')

if __name__=='__main__':
    if len(sys.argv)!=3:raise SystemExit(2)
    try:
        build(sys.argv[1],sys.argv[2])
    except Exception:
        print('BW_PORTABLE_ZIP_ERROR',file=sys.stderr)
        raise SystemExit(1) from None
