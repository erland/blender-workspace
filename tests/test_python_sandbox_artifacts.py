"""Regression tests for output verification on the trusted controller."""
import hashlib
import json
from pathlib import Path
import struct
from tempfile import TemporaryDirectory
import unittest
from uuid import uuid4

from modal_provider.artifact_validation import validate_python_outputs, ArtifactValidationError

def fake_glb():
    scene={'asset':{'version':'2.0'},'nodes':[{'mesh':0}],
           'meshes':[{'primitives':[]}],'scenes':[{'nodes':[0]}]}
    payload=json.dumps(scene).encode()
    payload+=b' '*(-len(payload)%4)
    return b'glTF'+struct.pack('<II',2,len(payload)+20)+struct.pack('<I4s',len(payload),b'JSON')+payload

def fixture(folder):
    folder=Path(folder)
    sources={'scene.blend':b'BLENDER-v302fake-bounded-header',
             'scene.glb':fake_glb()}
    for name,data in sources.items():
        (folder/name).write_bytes(data)
    report={'schema_version':1,'stage':'sandbox_python',
            'scene':{'objects':[{'name':'Cube','objectId':str(uuid4()),'type':'MESH'}]},
            'artifacts':[{'path':name,'size_bytes':len(data),
                          'sha256':hashlib.sha256(data).hexdigest()}
                         for name,data in sources.items()]}
    (folder/'scene.json').write_text(json.dumps(report))
    return report

class OutputValidationTests(unittest.TestCase):
    def test_good_structure(self):
        with TemporaryDirectory() as tmp:
            fixture(tmp)
            self.assertEqual(validate_python_outputs(tmp)['object_count'],1)

    def test_tampered_file_and_malformed_glb_blocked(self):
        with TemporaryDirectory() as tmp:
            fixture(tmp)
            (Path(tmp)/'scene.blend').write_bytes(b'not a blender file')
            with self.assertRaisesRegex(ValueError,'BLEND'):
                validate_python_outputs(tmp)
        with TemporaryDirectory() as tmp:
            fixture(tmp)
            (Path(tmp)/'scene.glb').write_bytes(b'invalid')
            with self.assertRaisesRegex(ValueError,'GLB'):
                validate_python_outputs(tmp)

    def test_duplicate_object_ids_blocked(self):
        with TemporaryDirectory() as tmp:
            report=fixture(tmp)
            report['scene']['objects'].append(dict(report['scene']['objects'][0],name='Other'))
            (Path(tmp)/'scene.json').write_text(json.dumps(report))
            with self.assertRaisesRegex(ValueError,'Duplicate'):
                validate_python_outputs(tmp)

    def test_missing_artifact_or_invalid_metadata_blocked(self):
        with TemporaryDirectory() as tmp:
            fixture(tmp)
            (Path(tmp)/'scene.blend').unlink()
            with self.assertRaisesRegex(ValueError,'Missing'):
                validate_python_outputs(tmp)
        with TemporaryDirectory() as tmp:
            report=fixture(tmp)
            report['artifacts'][0]['sha256']='0'*64
            (Path(tmp)/'scene.json').write_text(json.dumps(report))
            with self.assertRaisesRegex(ValueError,'checksum'):
                validate_python_outputs(tmp)

if __name__=='__main__':
    unittest.main()

class SafeReasonTests(unittest.TestCase):
    def test_missing_glb_reason_is_fixed_and_non_secret(self):
        with TemporaryDirectory() as tmp:
            fixture(tmp)
            (Path(tmp)/'scene.glb').unlink()
            with self.assertRaises(ArtifactValidationError) as captured:
                validate_python_outputs(tmp)
            self.assertEqual(captured.exception.reason,'glb_file_invalid')

    def test_invalid_glb_structure_reports_specific_reason(self):
        with TemporaryDirectory() as tmp:
            fixture(tmp)
            (Path(tmp)/'scene.glb').write_bytes(b'bad')
            with self.assertRaises(ArtifactValidationError) as captured:
                validate_python_outputs(tmp)
            self.assertEqual(captured.exception.reason,'glb_header_invalid')
