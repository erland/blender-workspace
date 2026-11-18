import unittest
from blender_workspace_poc.scene_edit_validation import validate_edit
class SceneEditTests(unittest.TestCase):
    def test_valid(self):
        self.assertEqual(validate_edit({'target':'Body','color':[0.2,0.6,1],'location':[0,-2,4],'scale':[1,2,0.5]})['target'],'Body')
    def test_invalid(self):
        tests=[{'target':'Other','color':[1,0,0]},{'target':'Body','script':'x'},
            {'target':'Body'},{'target':'Body','color':[1,0,1.1]},
            {'target':'Body','color':[1,0,float('nan')]},
            {'target':'Body','location':[20,0,0]},{'target':'Body','scale':[0,1,1]},
            {'target':'Body','scale':[True,1,1]},{'target':'Body','color':'blue'}]
        for edit in tests:
            with self.subTest(edit=edit),self.assertRaises(ValueError):validate_edit(edit)
