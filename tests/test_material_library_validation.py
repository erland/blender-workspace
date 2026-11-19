import unittest
from blender_workspace_poc.scene_operation_validation import validate_operation

class MaterialLibraryValidationTests(unittest.TestCase):
    def material(self, **overrides):
        return {**{'kind':'create_pbr_material','materialName':'Brushed Aluminium',
            'baseColor':[0.35,0.45,0.6],'metallic':0.9,'roughness':0.3,
            'opacity':1.0,'emissionColor':[0,0,0],'emissionStrength':0},**overrides}

    def test_valid_creation_and_assignment(self):
        material=self.material()
        assign={'kind':'assign_material','name':'Desk','materialName':'Brushed Aluminium'}
        self.assertEqual(validate_operation(material),material)
        self.assertEqual(validate_operation(assign),assign)
        self.assertEqual(validate_operation({
            'kind':'batch','operations':[{'kind':'add_primitive',
                'name':'Desk','primitive':'cube'},material,assign]
        })['kind'],'batch')

    def test_strict_rejection(self):
        for invalid in [
            self.material(materialName='../escape'),
            self.material(materialName=''),
            self.material(python='import os'),
            self.material(url='https://example.com/a.png'),
            self.material(baseColor=[1.1,0,0]),
            self.material(opacity=float('inf')),
            self.material(roughness=True),
            self.material(emissionStrength=2),
            {'kind':'assign_material','name':'Desk','materialName':'../bad'},
            {'kind':'assign_material','name':'Desk','materialName':'Aluminium','url':'https://example.com'},
            {'kind':'assign_material','name':'Desk','objectId':'11111111-1111-4111-8111-111111111111','materialName':'Aluminium'},
            {'kind':'assign_material','materialName':'Aluminium'},
            {'kind':'assign_material','name':'Desk','materialName':'Aluminium','script':'x'},
        ]:
            with self.subTest(invalid=invalid),self.assertRaises(ValueError):
                validate_operation(invalid)

if __name__=='__main__':
    unittest.main()
