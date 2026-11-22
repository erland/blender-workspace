import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {validateUpload,type UploadFormat,type UploadedAssetStore} from '../storage/uploaded-assets.js';
export interface UploadedAsset {
 id:string;owner_key:string;filename:string;format:UploadFormat;
 size_bytes:number;sha256:string;created_at:Date;
}
export class UploadedAssets {
 constructor(private readonly pool:Pool,private readonly store:UploadedAssetStore){}
 async upload(owner:string,filename:string,bytes:Buffer):Promise<UploadedAsset>{
  if(!owner.trim()||owner.length>200)throw new RangeError('Invalid owner');
  const checked=validateUpload(bytes,filename),id=randomUUID();
  await this.store.store(bytes,id,checked.format);
  try{
   const row=await this.pool.query<UploadedAsset>(
     `INSERT INTO bw_uploaded_assets(id,owner_key,filename,format,size_bytes,sha256)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [id,owner,filename,checked.format,checked.sizeBytes,checked.sha256]);
   return row.rows[0];
  }catch(error){await this.store.remove(id,checked.format);throw error;}
 }
 async get(owner:string,id:string):Promise<UploadedAsset|null>{
  if(!owner.trim()||owner.length>200)return null;
  return (await this.pool.query<UploadedAsset>(
    'SELECT * FROM bw_uploaded_assets WHERE id=$1 AND owner_key=$2',
    [id,owner])).rows[0]??null;
 }
 async list(owner:string,limit=40):Promise<UploadedAsset[]>{
  if(!owner.trim()||owner.length>200||!Number.isInteger(limit)||limit<1||limit>100)
   throw new RangeError('Invalid asset list request');
  return (await this.pool.query<UploadedAsset>(
   'SELECT * FROM bw_uploaded_assets WHERE owner_key=$1 ORDER BY created_at DESC,id DESC LIMIT $2',
   [owner,limit])).rows;
 }
 async verifiedPath(owner:string,id:string){
  const asset=await this.get(owner,id);
  if(!asset)throw new Error('Uploaded asset not found');
  return {path:await this.store.verifiedPath(asset.id,asset.format,asset.sha256,asset.size_bytes),
    format:asset.format};
 }
}
