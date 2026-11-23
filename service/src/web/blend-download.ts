/** Safe download filenames and conservative summaries for local Blender use. */

export function blendDownloadFilename(projectName:string,revision:number):string{
  if(!Number.isSafeInteger(revision)||revision<1||revision>99999999)
    throw new RangeError('Invalid revision');
  // ASCII-only filename and strict bound: no CRLF, separators, path traversal
  // or Content-Disposition injection even for untrusted project titles.
  const slug=projectName.normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^A-Za-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,70)
    .replace(/-+$/g,'')||'Blender-projekt';
  return slug+'-rev-'+revision+'.blend';
}

export type PortableResourceInfo={
  status:'complete'|'external'|'unknown';
  packedCount:number;
  externalCount:number;
  externalTypes:string[];
};
const RESOURCE_TYPES=new Set([
  'images','sounds','fonts','libraries','movieclips','volumes','cacheFiles',
  'sequencer'
]);

/** Never infer "complete" for older/corrupted reports or arbitrary JSON. */
export function portableResourceInfo(raw:unknown):PortableResourceInfo|undefined{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return undefined;
  const root=raw as Record<string,unknown>;
  const info=root.portableResources;
  if(!info||typeof info!=='object'||Array.isArray(info))return undefined;
  const p=info as Record<string,unknown>;
  if(p.schemaVersion!==1||
     !['complete','external','unknown'].includes(String(p.status))||
     !Number.isSafeInteger(p.packedCount)||(p.packedCount as number)<0||
     !Number.isSafeInteger(p.externalCount)||(p.externalCount as number)<0||
     (p.packedCount as number)>1000000||(p.externalCount as number)>1000000||
     !Array.isArray(p.externalTypes)||p.externalTypes.length>RESOURCE_TYPES.size||
     p.externalTypes.some(item=>typeof item!=='string'||!RESOURCE_TYPES.has(item))||
     new Set(p.externalTypes).size!==p.externalTypes.length||
     (p.status==='complete'&&p.externalCount!==0)||
     (p.status==='external'&&p.externalCount===0))return undefined;
  return {status:p.status as PortableResourceInfo['status'],
    packedCount:p.packedCount as number,externalCount:p.externalCount as number,
    externalTypes:p.externalTypes as string[]};
}
