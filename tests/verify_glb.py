"""Pure Python GLB structural verification, no external dependencies."""
import json
import struct
import sys
from pathlib import Path
def inspect_glb(path):
    data=Path(path).read_bytes()
    if len(data)<20: raise AssertionError('GLB too short')
    magic,version,length=struct.unpack_from('<4sII',data,0)
    assert magic==b'glTF' and version==2 and length==len(data)
    json_length,json_type=struct.unpack_from('<I4s',data,12)
    assert json_type==b'JSON' and 20+json_length<=len(data)
    model=json.loads(data[20:20+json_length].decode('utf-8'))
    assert model.get('meshes'),'GLB has no meshes'
    assert model.get('skins'),'GLB has no skin'
    animations=model.get('animations',[])
    assert animations,'GLB has no animations'
    channels=sum(len(anim.get('channels',[])) for anim in animations)
    assert channels>=2,'GLB is missing bone channels'
    for anim in animations: assert anim.get('samplers'),'GLB animation missing samplers'
    return {'meshes':len(model['meshes']),'skins':len(model['skins']),'animations':[a.get('name','unnamed') for a in animations],'channels':channels}
if __name__=='__main__':
    for p in sys.argv[1:]: print(f'BW_GLB {p}: {json.dumps(inspect_glb(p))}')
