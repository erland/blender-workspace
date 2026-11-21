"""MODEL-001 regression for large scenes and artifact-specific bounds."""
import hashlib
import json
from pathlib import Path
import unittest
from tempfile import TemporaryDirectory
from uuid import uuid4

from modal_provider.artifact_validation import (
    MAX_BLEND_BYTES, MAX_GLB_BYTES, MAX_REPORT_BYTES,
    ArtifactValidationError, validate_python_outputs
)

class ModelBudgets(unittest.TestCase):
    def test_artifact_budgets_are_separate(self):
        self.assertEqual(MAX_BLEND_BYTES,256*1024*1024)
        self.assertEqual(MAX_GLB_BYTES,128*1024*1024)
        self.assertEqual(MAX_REPORT_BYTES,16*1024*1024)

    def test_reports_over_previous_512_object_ceiling_are_accepted(self):
        with TemporaryDirectory() as tmp:
            folder=Path(tmp)
            blend=b'BLENDER-v302model-resource-test'
            (folder/'scene.blend').write_bytes(blend)
            objects=[{'name':f'Object {i}','objectId':str(uuid4()),'type':'EMPTY'}
                     for i in range(520)]
            report={'schema_version':1,'stage':'sandbox_python',
                    'scene':{'objects':objects},
                    'artifacts':[{'path':'scene.blend','size_bytes':len(blend),
                                  'sha256':hashlib.sha256(blend).hexdigest()}],
                    'preview':{'format':'glb','status':'unavailable','reason':'export_failed'}}
            (folder/'scene.json').write_text(json.dumps(report))
            result=validate_python_outputs(folder)
            self.assertEqual(result['object_count'],520)
            self.assertFalse(result['glb_available'])

    def test_bad_checksum_is_still_rejected_for_larger_scene(self):
        with TemporaryDirectory() as tmp:
            folder=Path(tmp)
            blend=b'BLENDER-v302model-resource-test'
            (folder/'scene.blend').write_bytes(blend)
            report={'schema_version':1,'stage':'sandbox_python',
                    'scene':{'objects':[{'name':f'O{i}','objectId':str(uuid4())}
                                       for i in range(520)]},
                    'artifacts':[{'path':'scene.blend','size_bytes':len(blend),
                                  'sha256':'0'*64}]}
            (folder/'scene.json').write_text(json.dumps(report))
            with self.assertRaises(ArtifactValidationError) as caught:
                validate_python_outputs(folder)
            self.assertEqual(caught.exception.reason,'artifact_checksum_mismatch')
