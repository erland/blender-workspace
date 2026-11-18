"""Strict standalone validation of data-only scene edits."""
import math
def validate_edit(value):
    if not isinstance(value,dict) or set(value)-{'target','color','location','scale'}:
        raise ValueError('Invalid edit fields')
    if value.get('target')!='Body' or not any(k in value for k in ('color','location','scale')):
        raise ValueError('Unsupported target or empty edit')
    for key,low,high in (('color',0,1),('location',-10,10),('scale',0.1,4)):
        if key in value:
            values=value[key]
            if (not isinstance(values,list) or len(values)!=3 or
                any(type(n) not in (int,float) or not math.isfinite(n) or not low<=n<=high for n in values)):
                raise ValueError('Invalid '+key)
    return value
