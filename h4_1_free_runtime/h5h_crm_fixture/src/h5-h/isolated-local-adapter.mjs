// Browser LOCALSTORAGE ONLY. No Auth, JWT, PostgreSQL, private file access, or approved finance rights.
// Do not substitute this for the H5-G RPCs in any real integration.
import {VersionConflict} from '../h5-b/draft-engine.mjs';
export class IsolatedLocalDraftAdapter{
 constructor(storage,{prefix='crm-h5h-fixture:'}={}){
  if(!storage||typeof storage.getItem!=='function'||typeof storage.setItem!=='function')throw Error('LOCAL_STORAGE_REQUIRED');
  this.storage=storage;this.prefix=prefix;
 }
 async create(id,data={}){
  if(this.storage.getItem(this.prefix+'row:'+id)!==null)throw Error('DUPLICATE_FIXTURE_DRAFT');
  const row={id,version:1,data:structuredClone(data)};
  this.storage.setItem(this.prefix+'row:'+id,JSON.stringify(row));
  return structuredClone(row);
 }
 async load(id){
  const row=this.storage.getItem(this.prefix+'row:'+id);
  return row===null?null:JSON.parse(row);
 }
 async save({id,expectedVersion,data,mutationId}){
  if(!mutationId||typeof mutationId!=='string')throw Error('MISSING_MUTATION_ID');
  const key=this.prefix+'receipt:'+id+':'+mutationId;
  const old=this.storage.getItem(key);
  if(old!==null){
   const saved=JSON.parse(old);
   if(saved.version!==expectedVersion+1||JSON.stringify(saved.data)!==JSON.stringify(data))
    throw Error('MUTATION_PAYLOAD_CONFLICT');
   return saved;
  }
  const cur=await this.load(id);
  if(!cur)throw Error('FIXTURE_NOT_FOUND');
  if(cur.version!==expectedVersion)throw new VersionConflict(cur);
  const next={id,version:cur.version+1,data:structuredClone(data)};
  this.storage.setItem(this.prefix+'row:'+id,JSON.stringify(next));
  this.storage.setItem(key,JSON.stringify(next));
  return structuredClone(next);
 }
}
