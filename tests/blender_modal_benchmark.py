"""Fixed Blender workload for Modal Function vs Sandbox measurements.

No user-supplied code, networking, credentials, source BLEND or file mounts.
Both modes execute this exact same script from the same Docker image.
"""
import json
import time
from pathlib import Path
import bpy

started=time.perf_counter()
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)

# Reproducible moderate static scene (42 meshes + a boolean + bevel).
for x in range(7):
    for y in range(6):
        bpy.ops.mesh.primitive_cube_add(size=1, location=(x*1.7,y*1.7,0))
        obj=bpy.context.object
        obj.name=f"Cell_{x:02d}_{y:02d}"
        obj.scale=(0.5,0.5,0.4+0.02*(x+y))
        if (x+y)%3==0:
            modifier=obj.modifiers.new("Benchmark bevel","BEVEL")
            modifier.width=0.08
            modifier.segments=2
            bpy.ops.object.modifier_apply(modifier=modifier.name)

bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=12,radius=1.6,location=(6,4,2.5))
sphere=bpy.context.object
sphere.name="Benchmark sphere"
material=bpy.data.materials.new("Benchmark PBR")
material.use_nodes=True
nodes=material.node_tree.nodes
bsdf=nodes.get("Principled BSDF")
bsdf.inputs["Base Color"].default_value=(0.15,0.45,0.85,1)
bsdf.inputs["Metallic"].default_value=0.65
bsdf.inputs["Roughness"].default_value=0.3
sphere.data.materials.append(material)

# Commit the same polygon data to GLB in each execution mode.
out=Path("/tmp/bw-modal-benchmark.glb")
bpy.ops.export_scene.gltf(
    filepath=str(out),export_format="GLB",use_selection=False,
    export_apply=False,export_extras=True
)
meshes=[obj for obj in bpy.data.objects if obj.type=="MESH"]
summary={
    "mesh_objects":len(meshes),
    "vertices":sum(len(obj.data.vertices) for obj in meshes),
    "polygons":sum(len(obj.data.polygons) for obj in meshes),
    "glb_bytes":out.stat().st_size,
    "blender_seconds":round(time.perf_counter()-started,6)
}
assert summary["mesh_objects"]==43
assert summary["glb_bytes"]>1000
print("BW_MODAL_BENCH_RESULT "+json.dumps(summary,sort_keys=True),flush=True)
