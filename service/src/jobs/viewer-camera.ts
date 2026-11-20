/** Bounded user-supplied camera from the glTF/Three.js Y-up viewer. */
export interface ViewerCamera {
 type:'perspective';
 position:[number,number,number];
 target:[number,number,number];
 up:[number,number,number];
 verticalFovDegrees:number;
}
const vector=(v:unknown):v is [number,number,number] =>
 Array.isArray(v)&&v.length===3&&v.every(x=>typeof x==='number'&&
 Number.isFinite(x)&&Math.abs(x)<=1_000_000);
export function validateViewerCamera(value:unknown):ViewerCamera {
 if(!value||typeof value!=='object'||Array.isArray(value))throw new RangeError('Invalid camera');
 const c=value as Record<string,unknown>;
 if(Object.keys(c).sort().join(',')!=='position,target,type,up,verticalFovDegrees'||
   c.type!=='perspective'||!vector(c.position)||!vector(c.target)||!vector(c.up)||
   typeof c.verticalFovDegrees!=='number'||!Number.isFinite(c.verticalFovDegrees)||
   c.verticalFovDegrees<10||c.verticalFovDegrees>100)throw new RangeError('Invalid camera');
 const direction=c.target.map((x,i)=>x-(c.position as number[])[i]);
 const d=Math.hypot(...direction),u=Math.hypot(...c.up);
 if(d<1e-5||u<0.5||u>2)throw new RangeError('Invalid camera direction');
 const cross=[direction[1]*c.up[2]-direction[2]*c.up[1],
   direction[2]*c.up[0]-direction[0]*c.up[2],
   direction[0]*c.up[1]-direction[1]*c.up[0]];
 if(Math.hypot(...cross)/(d*u)<0.01)throw new RangeError('Camera up is parallel to view');
 return c as unknown as ViewerCamera;
}
/** Same aspect as canvas; short edge 256, long edge limited to 1024. */
export function viewerDimensions(width:number,height:number):{width:number;height:number} {
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)
   throw new RangeError('Invalid viewport');
 const ratio=width/height;
 if(ratio<0.25||ratio>4)throw new RangeError('Viewport aspect exceeds safe limit');
 return ratio>=1?{width:Math.round(256*ratio),height:256}:
   {width:256,height:Math.round(256/ratio)};
}
