"""Snapshot mesh geometry and quality indicators without mutating the model.

Used by the existing immutable scene report, NOT by an extra Modal job.
Only base mesh topology is inspected; unapplied modifiers are NOT evaluated.
"""
import math
from collections import Counter
from mathutils import Vector

def _finite(value):
    result=float(value)
    if not math.isfinite(result):
        raise ValueError("Non-finite geometry measurement")
    return result

def _world_bounds(obj):
    points=[obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    minimum=[_finite(min(p[axis] for p in points)) for axis in range(3)]
    maximum=[_finite(max(p[axis] for p in points)) for axis in range(3)]
    return {
        "min":minimum, "max":maximum,
        "dimensions":[_finite(maximum[i]-minimum[i]) for i in range(3)]
    }

def describe_mesh(obj):
    mesh=obj.data
    vertex_count=len(mesh.vertices)
    edge_count=len(mesh.edges)
    face_count=len(mesh.polygons)
    # Count face incidence per edge, including degenerate or wire-only meshes.
    # mesh.polygons[].edge_keys yields pairs of local vertex indices.
    incident=Counter()
    for face in mesh.polygons:
        for edge in face.edge_keys:
            incident[tuple(sorted(edge))]+=1
    edge_keys={tuple(sorted(edge.vertices)) for edge in mesh.edges}
    boundary=sum(incident[key]==1 for key in edge_keys)
    non_manifold=sum(incident[key]>2 for key in edge_keys)
    loose=sum(incident[key]==0 for key in edge_keys)
    used_vertices={int(index) for edge in mesh.edges for index in edge.vertices}
    isolated=vertex_count-len(used_vertices)
    degenerate=sum(not math.isfinite(float(face.area)) or float(face.area)<=1e-10
                   for face in mesh.polygons)
    checks={
        "boundaryEdges":boundary,
        "nonManifoldEdges":non_manifold,
        "looseEdges":loose,
        "isolatedVertices":isolated,
        "degenerateFaces":degenerate,
    }
    # These counts are diagnostic, NOT watertightness, normals or print-readiness proofs.
    warnings=[]
    for key,code in (
        ("boundaryEdges","open_boundaries"),
        ("nonManifoldEdges","non_manifold_edges"),
        ("looseEdges","loose_edges"),
        ("isolatedVertices","isolated_vertices"),
        ("degenerateFaces","degenerate_faces")
    ):
        if checks[key]>0:
            warnings.append({"code":code,"count":checks[key]})
    if face_count==0:
        warnings.append({"code":"no_faces","count":1})
    return {
        "vertexCount":vertex_count,
        "edgeCount":edge_count,
        "faceCount":face_count,
        "triangleCount":sum(max(0,len(face.vertices)-2) for face in mesh.polygons),
        "uvLayerCount":len(mesh.uv_layers),
        "modifiers":[{"name":m.name,"type":m.type} for m in obj.modifiers][:64],
        "worldBounds":_world_bounds(obj),
        "qualityChecks":checks,
        "warnings":warnings,
    }
