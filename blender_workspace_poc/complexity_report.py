"""Bounded, non-evaluating scene complexity snapshot for DEV-044.

Never call evaluated_get(), to_mesh(), a dependency-graph evaluation, or
procedural node evaluation just to collect diagnostics. Counts describe
stored datablocks only; child hair and generated meshes remain unknown.
"""
MAX_MODIFIERS = 64
MAX_COUNT = 1_000_000_000


def _count(collection):
    return min(len(collection), MAX_COUNT)


def describe_complexity(obj):
    """Read cheap, stored geometry facts; no render or modifier evaluation."""
    kind = obj.type
    record = {
        "source": "stored",
        "evaluated": False,
        "proceduralPotential": False,
        "modifiers": [],
    }
    for modifier in list(obj.modifiers)[:MAX_MODIFIERS]:
        modifier_type = str(modifier.type)
        record["modifiers"].append({
            "name": str(modifier.name)[:512],
            "type": modifier_type[:512],
            "procedural": modifier_type in {
                "NODES", "PARTICLE_SYSTEM", "SUBSURF", "MULTIRES",
                "ARRAY", "SOLIDIFY", "BEVEL", "REMESH", "SCREW",
            },
        })
    record["proceduralPotential"] = any(
        item["procedural"] for item in record["modifiers"]
    )
    if kind == "MESH":
        mesh = obj.data
        record["mesh"] = {
            "vertices": _count(mesh.vertices),
            "edges": _count(mesh.edges),
            "faces": _count(mesh.polygons),
        }
    elif kind == "CURVES":
        curves = obj.data
        record["hair"] = {
            "curveCount": _count(curves.curves),
            "pointCount": _count(curves.points),
            "interpolatedCount": None,
        }
    elif kind == "CURVE":
        record["splines"] = _count(obj.data.splines)
    elif kind == "POINTCLOUD":
        record["points"] = _count(obj.data.points)
    # No evaluated estimate is synthesized for geometry nodes or child hair.
    return record
