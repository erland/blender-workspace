"""Deterministic example: first revision from Python, then editable by UUID.

This script is an EXAMPLE of untrusted input, not part of trusted worker.
"""
import bpy
bpy.ops.mesh.primitive_cube_add(size=2,location=(0,0,0))
bpy.context.object.name='Python Cube'
bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=8,radius=0.7,location=(2,0,1))
bpy.context.object.name='Python Sphere'
