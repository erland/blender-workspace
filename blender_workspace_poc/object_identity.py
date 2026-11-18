"""Persistent model-independent identity for Blender objects.

Uses the object custom-property namespace, which is saved in .blend and
exported as glTF node extras. This module itself has no bpy dependency.
"""
from uuid import UUID, uuid4

PROPERTY='bw_object_id'

def valid_object_id(value):
    if not isinstance(value,str):
        return False
    try:
        return str(UUID(value,version=4))==value
    except (ValueError,AttributeError,TypeError):
        return False

def ensure_object_ids(objects):
    """Backfill legacy objects, repair duplicate IDs and preserve valid IDs.

    Objects are visited in deterministic name order; IDs are generated only
    where absent, malformed or duplicated. Never interpret names as identity.
    """
    seen=set()
    for obj in sorted(objects,key=lambda item:item.name):
        value=obj.get(PROPERTY)
        if not valid_object_id(value) or value in seen:
            value=str(uuid4())
            obj[PROPERTY]=value
        seen.add(value)
    return seen

def assign_new_object_id(obj):
    """Use on a Blender copy, which otherwise inherits the source object's ID."""
    value=str(uuid4())
    obj[PROPERTY]=value
    return value
