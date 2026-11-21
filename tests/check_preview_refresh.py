"""CI checks regenerated GLB material color and original BLEND immutability."""
import hashlib,json,struct
from pathlib import Path
folder=Path('preview001-out')
source=folder/'input.blend'
preview=folder/'preview.glb'
assert source.read_bytes().startswith(b'BLENDER')
assert hashlib.sha256(source.read_bytes()).hexdigest()==(folder/'before.sha256').read_text().strip()
binary=preview.read_bytes()
assert binary[:4]==b'glTF'
size,kind=struct.unpack_from('<I4s',binary,12)
assert kind==b'JSON'
data=json.loads(binary[20:20+size])
materials=data.get('materials',[])
assert materials, data.keys()
pbr=[m.get('pbrMetallicRoughness',{}) for m in materials]
factors=[x.get('baseColorFactor') for x in pbr if x.get('baseColorFactor')]
assert any(v[1]>v[0] and v[0]<0.6 for v in factors), factors
report=json.loads((folder/'preview-report.json').read_text())
assert report['materialCheck']['status']=='ok',report
assert report['materialCheck']['fallbackMaterials']>0
print('BW_PREVIEW001_REFRESH PASS')
