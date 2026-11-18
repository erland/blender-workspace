import unittest
from blender_workspace_poc.scene_operation_validation import validate_operation

class SceneOperationValidationTests(unittest.TestCase):
    def test_allowed_operations(self):
        valid=[
            {'kind':'add_primitive','name':'Modern Office Chair','primitive':'cube','color':[0.2,0.4,0.7]},
            {'kind':'add_primitive','name':'Wheel 1','primitive':'cylinder','location':[2,0,0]},
            {'kind':'set_transform','name':'Modern Office Chair','location':[2,1,0]},
            {'kind':'set_color','name':'Wheel 1','color':[0,0,0]},
            {'kind':'delete_object','name':'Wheel 1'}]
        for op in valid:self.assertEqual(validate_operation(op),op)
    def test_batch_operations(self):
        ops={'kind':'batch','operations':[
            {'kind':'add_primitive','name':'Tabletop','primitive':'cube'},
            {'kind':'add_primitive','name':'Leg 1','primitive':'cylinder'},
            {'kind':'set_color','name':'Leg 1','color':[0.3,0.2,0.1]}]}
        self.assertEqual(validate_operation(ops),ops)
    def test_rejects_batch_bypass(self):
        add={'kind':'add_primitive','name':'Cube','primitive':'cube'}
        cases=[
            {'kind':'batch','operations':[]},
            {'kind':'batch','operations':[add]*21},
            {'kind':'batch','operations':[{'kind':'batch','operations':[add]}]},
            {'kind':'batch','operations':[{**add,'script':'evil'}]},
            {'kind':'batch','operations':[add],'python':'print(1)'},
            {'kind':'batch','operations':'not-an-array'},
        ]
        for value in cases:
            with self.subTest(value=value),self.assertRaises(ValueError):
                validate_operation(value)
    def test_rejects_untrusted_instructions(self):
        bad=[
            {'kind':'run_python','name':'x','code':'print(1)'},
            {'kind':'add_primitive','name':'x','primitive':'unsafe'},
            {'kind':'add_primitive','name':'../x','primitive':'cube'},
            {'kind':'add_primitive','name':'x','primitive':'cube','script':'a'},
            {'kind':'set_transform','name':'x'},
            {'kind':'set_transform','name':'x','location':[float('nan'),0,0]},
            {'kind':'set_color','name':'x','color':[2,0,0]},
            {'kind':'delete_object','name':'x','path':'/tmp/secret'}]
        for op in bad:
            with self.subTest(op=op),self.assertRaises(ValueError):validate_operation(op)
