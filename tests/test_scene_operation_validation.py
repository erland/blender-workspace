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
    def test_duplicate_object_contract(self):
        item={'kind':'duplicate_object','source':'Desk leg','name':'Desk leg 2',
              'location':[2,0,0],'rotation':[0,0,1.57]}
        self.assertEqual(validate_operation(item),item)
        self.assertEqual(validate_operation({'kind':'batch','operations':[
            {'kind':'add_primitive','name':'Base','primitive':'cube'},
            {'kind':'duplicate_object','source':'Base','name':'Copy'}]})['kind'],'batch')
        for invalid in [
            {'kind':'duplicate_object','source':'Base','name':'Base'},
            {'kind':'duplicate_object','source':'../Base','name':'Copy'},
            {'kind':'duplicate_object','source':'Base','name':'Copy','script':'run()'},
            {'kind':'duplicate_object','source':'Base','name':'Copy','location':[float('inf'),0,0]},
            {'kind':'duplicate_object','name':'Copy'},
            {'kind':'duplicate_object','source':'Base','name':'Copy','scale':[0,1,1]},
        ]:
            with self.subTest(invalid=invalid),self.assertRaises(ValueError):
                validate_operation(invalid)

    def test_rename_object_contract(self):
        operation={'kind':'rename_object','name':'Desk leg','newName':'Table leg'}
        self.assertEqual(validate_operation(operation),operation)
        for invalid in [
            {'kind':'rename_object','name':'Desk leg','newName':'Desk leg'},
            {'kind':'rename_object','name':'Desk leg','newName':'../escape'},
            {'kind':'rename_object','name':'Desk leg'},
            {'kind':'rename_object','name':'Desk leg','newName':'Valid','script':'danger'},
            {'kind':'rename_object','name':'Desk leg','newName':42},
        ]:
            with self.subTest(invalid=invalid),self.assertRaises(ValueError):
                validate_operation(invalid)

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

    def test_dev023_id_selectors_and_hierarchy(self):
        id1='11111111-1111-4111-8111-111111111111'
        id2='22222222-2222-4222-8222-222222222222'
        valid=[
            {'kind':'set_transform','objectId':id1,'location':[1,2,3]},
            {'kind':'set_color','objectId':id1,'color':[0.2,0.3,0.4]},
            {'kind':'rename_object','objectId':id1,'newName':'Changed'},
            {'kind':'delete_object','objectId':id1},
            {'kind':'duplicate_object','sourceId':id1,'name':'New copy'},
            {'kind':'set_parent','name':'Child','parentId':id2},
            {'kind':'set_parent','objectId':id1,'parentId':None}]
        for op in valid:
            with self.subTest(op=op):self.assertEqual(validate_operation(op),op)
        for invalid in [
            {'kind':'set_transform','location':[1,0,0]},
            {'kind':'set_transform','name':'Child','objectId':id1,'location':[1,0,0]},
            {'kind':'set_parent','name':'Child'},
            {'kind':'set_parent','objectId':id1,'parentId':id1},
            {'kind':'set_parent','objectId':id1,'parentId':'bad'},
            {'kind':'set_parent','name':'Child','parentId':id2,'python':'unsafe'},
            {'kind':'duplicate_object','source':'Child','sourceId':id1,'name':'Copy'},
            {'kind':'rename_object','objectId':id1,'name':'Child','newName':'Else'},
            {'kind':'delete_object','objectId':'../unsafe'},
        ]:
            with self.subTest(invalid=invalid),self.assertRaises(ValueError):
                validate_operation(invalid)

    def test_dev024_custom_mesh_bounds(self):
        cube={'kind':'add_mesh','name':'Custom triangular part',
              'vertices':[[0,0,0],[2,0,0],[0,2,0],[0,0,1]],
              'faces':[[0,1,2],[0,2,3]],'color':[0.4,0.7,0.9]}
        self.assertEqual(validate_operation(cube),cube)
        for invalid in [
            {**cube,'vertices':[[0,0,0],[2,0,0]]},
            {**cube,'vertices':[[0,0,0],[1,0,0],[float('inf'),1,0]]},
            {**cube,'vertices':[[0,0,0],[1,0,0],[101,1,0]]},
            {**cube,'faces':[]},
            {**cube,'faces':[[0,1]]},
            {**cube,'faces':[[0,1,1]]},
            {**cube,'faces':[[0,1,5]]},
            {**cube,'faces':[[0,1,-1]]},
            {**cube,'faces':[[0,1,True]]},
            {**cube,'faces':[[0,1,2,3,0]]},
            {**cube,'faces':[[0,1,2]]*2049},
            {**cube,'python':'print(1)'},
            {**cube,'color':[3,0,0]},
        ]:
            with self.subTest(invalid=invalid),self.assertRaises(ValueError):
                validate_operation(invalid)
        self.assertEqual(validate_operation({'kind':'batch','operations':[cube]})['kind'],'batch')

    def test_dev025_mesh_modifiers(self):
        a='11111111-1111-4111-8111-111111111111'
        b='22222222-2222-4222-8222-222222222222'
        operations=[
            {'kind':'bevel_mesh','objectId':a,'width':0.2,'segments':2},
            {'kind':'subdivide_mesh','name':'Panel','levels':2},
            {'kind':'boolean_mesh','objectId':a,'operandId':b,'operation':'difference'},
            {'kind':'boolean_mesh','name':'Panel','operandId':b,'operation':'union'},
            {'kind':'boolean_mesh','name':'Panel','operandId':b,'operation':'intersection'}
        ]
        for op in operations:
            with self.subTest(op=op):
                self.assertEqual(validate_operation(op),op)
        for op in [
            {'kind':'bevel_mesh','name':'Panel','width':0,'segments':1},
            {'kind':'bevel_mesh','name':'Panel','width':float('nan'),'segments':1},
            {'kind':'bevel_mesh','name':'Panel','width':3,'segments':1},
            {'kind':'bevel_mesh','name':'Panel','width':0.1,'segments':4},
            {'kind':'bevel_mesh','name':'Panel','width':0.1,'segments':True},
            {'kind':'subdivide_mesh','name':'Panel','levels':0},
            {'kind':'subdivide_mesh','name':'Panel','levels':3},
            {'kind':'subdivide_mesh','name':'Panel','levels':1.5},
            {'kind':'boolean_mesh','name':'Panel','operandId':b,'operation':'script'},
            {'kind':'boolean_mesh','objectId':a,'operandId':a,'operation':'union'},
            {'kind':'boolean_mesh','name':'Panel','operandId':'bad','operation':'union'},
            {'kind':'boolean_mesh','name':'Panel','operandId':b,'operation':'union','python':'evil'},
            {'kind':'bevel_mesh','name':'Panel','objectId':a,'width':0.1,'segments':1},
        ]:
            with self.subTest(invalid=op),self.assertRaises(ValueError):
                validate_operation(op)

    def test_dev026_extrude_mirror_array(self):
        object_id='11111111-1111-4111-8111-111111111111'
        good=[
            {'kind':'extrude_face','objectId':object_id,'faceIndex':0,'offset':[0,0,1]},
            {'kind':'mirror_mesh','name':'Panel','axis':'x'},
            {'kind':'array_mesh','objectId':object_id,'count':3,'offset':[2,0,0]},
        ]
        for op in good:
            with self.subTest(op=op):self.assertEqual(validate_operation(op),op)
        for bad in [
            {'kind':'extrude_face','name':'Panel','faceIndex':-1,'offset':[0,0,1]},
            {'kind':'extrude_face','name':'Panel','faceIndex':40000,'offset':[0,0,1]},
            {'kind':'extrude_face','name':'Panel','faceIndex':True,'offset':[0,0,1]},
            {'kind':'extrude_face','name':'Panel','faceIndex':1.5,'offset':[0,0,1]},
            {'kind':'extrude_face','name':'Panel','faceIndex':1,'offset':[0,0,0]},
            {'kind':'extrude_face','name':'Panel','faceIndex':1,'offset':[float('nan'),0,1]},
            {'kind':'mirror_mesh','name':'Panel','axis':'q'},
            {'kind':'mirror_mesh','name':'Panel','axis':['x']},
            {'kind':'array_mesh','name':'Panel','count':1,'offset':[2,0,0]},
            {'kind':'array_mesh','name':'Panel','count':9,'offset':[2,0,0]},
            {'kind':'array_mesh','name':'Panel','count':True,'offset':[2,0,0]},
            {'kind':'array_mesh','name':'Panel','count':2,'offset':[0,0,0]},
            {'kind':'array_mesh','name':'Panel','count':2,'offset':[12,0,0]},
            {'kind':'array_mesh','name':'Panel','count':2,'offset':[1,0,0],'python':'evil'},
            {'kind':'mirror_mesh','name':'Panel','objectId':object_id,'axis':'x'},
        ]:
            with self.subTest(bad=bad),self.assertRaises(ValueError):
                validate_operation(bad)
