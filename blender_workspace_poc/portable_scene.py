"""Pack portable Blender resources during the existing sandbox modeling job.

The scene's native BLEND remains authoritative. Only bounded *counts* and
resource categories enter the public artifact report; never disclose paths,
names, or raw source metadata. Unsupported dependencies are *not* claimed
portable. Existing revisions remain immutable and cannot be retro-packed.
"""
import bpy

# These are reports of *known* external dependencies. Other custom add-ons
# can use external resources that Blender's generic pack operation cannot see.
RESOURCE_TYPES=(
    'images','sounds','fonts','libraries','movieclips','volumes','cacheFiles',
    'sequencer',
)


def _is_packed(block):
    if getattr(block,'packed_file',None) is not None:
        return True
    packed_files=getattr(block,'packed_files',None)
    return packed_files is not None and len(packed_files)>0


def _collect_portability():
    packed=0
    external={key:0 for key in RESOURCE_TYPES}

    for image in bpy.data.images:
        source=image.source
        if source not in {'FILE','TILED','MOVIE','SEQUENCE'}:
            continue
        if source in {'MOVIE','SEQUENCE'}:
            external['images']+=1
            continue
        packed_image=_is_packed(image)
        # A tiled image is only portable when *all* referenced tiles have
        # packed files; packing a single tile is not enough.
        if source=='TILED':
            tiles=len(image.tiles)
            packed_tiles=len(getattr(image,'packed_files',()))
            packed_image=tiles>0 and packed_tiles>=tiles
        if packed_image:
            packed+=1
        else:
            external['images']+=1

    for category,collection in [
        ('sounds',bpy.data.sounds),('fonts',bpy.data.fonts),
        ('libraries',bpy.data.libraries),
    ]:
        for block in collection:
            filepath=getattr(block,'filepath','')
            if not filepath or filepath=='<builtin>':
                continue
            if _is_packed(block):
                packed+=1
            else:
                external[category]+=1

    for category,collection in [
        ('movieclips',bpy.data.movieclips),
        ('volumes',getattr(bpy.data,'volumes',())),
        ('cacheFiles',bpy.data.cache_files),
    ]:
        for block in collection:
            if getattr(block,'filepath',''):
                external[category]+=1

    for scene in bpy.data.scenes:
        sequencer=scene.sequence_editor
        if sequencer is None:
            continue
        strips=getattr(sequencer,'strips_all',None)
        if strips is None:
            strips=getattr(sequencer,'sequences_all',())
        for strip in strips:
            if strip.type in {'MOVIE','IMAGE','SOUND'}:
                external['sequencer']+=1

    external_count=sum(external.values())
    return {'packedCount':packed,'externalCount':external_count,
            'externalTypes':[key for key,count in external.items() if count]}


def pack_scene_resources():
    """Pack accessible resources; report incomplete/unknown instead of failing
    a paid modeling job after its scene geometry has been created.
    """
    try:
        result=bpy.ops.file.pack_all()
        succeeded='FINISHED' in result
    except Exception:
        succeeded=False
    try:
        summary=_collect_portability()
    except Exception:
        return {'schemaVersion':1,'status':'unknown','packedCount':0,
                'externalCount':0,'externalTypes':[]}
    return {'schemaVersion':1,
            'status':('complete' if succeeded and summary['externalCount']==0
                      else 'external' if summary['externalCount'] else 'unknown'),
            **summary}
