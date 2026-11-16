"""Check manifest, scene contents, revision, hashes and artifacts."""
import hashlib
import json
import sys
from pathlib import Path
def verify(root):
    root=Path(root)
    expected={'Body','LeftLeg','RightLeg','LeftEye','RightEye','MonsterRig'}
    for version in (1,2):
        manifest=json.loads((root/f'monster_v{version}.json').read_text())
        scene=manifest['scene']
        names={o['name'] for o in scene['objects']}
        assert expected.issubset(names),(version,names)
        assert 'WalkCycle' in scene['actions']
        assert scene['armature_animation']
        assert scene['fps']==24 and scene['frame_start']==1 and scene['frame_end']==49
        for artifact in manifest['artifacts']:
            p=root/artifact['path']
            assert p.exists() and p.stat().st_size==artifact['size_bytes']
            assert hashlib.sha256(p.read_bytes()).hexdigest()==artifact['sha256']
    m1=json.loads((root/'monster_v1.json').read_text())
    m2=json.loads((root/'monster_v2.json').read_text())
    mat1=next(o['materials'] for o in m1['scene']['objects'] if o['name']=='Body')
    mat2=next(o['materials'] for o in m2['scene']['objects'] if o['name']=='Body')
    assert 'Monster_Green' in mat1 and 'Monster_Blue' in mat2
    assert (root/'monster_v1.blend').read_bytes()!=(root/'monster_v2.blend').read_bytes()
    print('BW_VERIFY manifests, hashes, revisions: PASS')
if __name__=='__main__': verify(sys.argv[1])
