import unittest
from uuid import uuid4
from blender_workspace_poc.object_identity import (
    PROPERTY,valid_object_id,ensure_object_ids,assign_new_object_id
)

class FakeObject(dict):
    def __init__(self,name,**properties):
        super().__init__(properties)
        self.name=name

class ObjectIdentityTests(unittest.TestCase):
    def test_backfill_and_preservation(self):
        old=FakeObject('Old box')
        existing=str(uuid4())
        named=FakeObject('Named part',**{PROPERTY:existing})
        ids=ensure_object_ids([old,named])
        self.assertEqual(named[PROPERTY],existing)
        self.assertTrue(valid_object_id(old[PROPERTY]))
        self.assertEqual(len(ids),2)
        again=ensure_object_ids([old,named])
        self.assertEqual(ids,again)

    def test_duplicate_and_malformed_ids_are_repaired(self):
        shared=str(uuid4())
        first=FakeObject('A',**{PROPERTY:shared})
        second=FakeObject('B',**{PROPERTY:shared})
        malformed=FakeObject('C',**{PROPERTY:'../invalid'})
        ids=ensure_object_ids([malformed,second,first])
        self.assertEqual(first[PROPERTY],shared)
        self.assertNotEqual(second[PROPERTY],shared)
        self.assertTrue(valid_object_id(malformed[PROPERTY]))
        self.assertEqual(len(ids),3)

    def test_copied_object_receives_fresh_identity(self):
        old=str(uuid4())
        original=FakeObject('Original',**{PROPERTY:old})
        duplicate=FakeObject('Copy',**{PROPERTY:old})
        assigned=assign_new_object_id(duplicate)
        self.assertNotEqual(assigned,old)
        self.assertEqual(original[PROPERTY],old)
        self.assertEqual(duplicate[PROPERTY],assigned)

    def test_uuid_version_and_input_validation(self):
        for invalid in [None,12,[],{},'random-id','00000000-0000-0000-0000-000000000000']:
            self.assertFalse(valid_object_id(invalid))
        self.assertTrue(valid_object_id(str(uuid4())))
