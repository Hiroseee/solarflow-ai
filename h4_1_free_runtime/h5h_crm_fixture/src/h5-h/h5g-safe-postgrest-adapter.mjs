// H5-H adapter for the H5-G DISPOSABLE authenticated Auth/REST fixtures only.
// Never write financial fields, issuance metadata or unauthorized association fields.
// This reuses, rather than duplicates, the official H5-G fixture RPCs.
import {VersionConflict} from '../h5-b/draft-engine.mjs';
const permitted=['client','kitChoice','items'];
function checked(data){
 if(!data||typeof data!=='object'||Array.isArray(data)||
  Object.keys(data).some(k=>!permitted.includes(k)))
  throw Error('H5G_DENY_BY_DEFAULT_FINANCIAL_OR_METADATA_FIELD');
 return data;
}
function checkedId(value){if(typeof value!=='string'||!value.trim())throw Error('INVALID_ID');return value;}
export class H5GIsolatedPostgrestDraftAdapter{
 constructor(client){if(!client||typeof client.rpc!=='function')throw Error('AUTHENTICATED_CLIENT_REQUIRED');this.client=client}
 async create(id,data={}){
  checkedId(id);const {data:row,error}=await this.client.rpc('h5g_safe_create',{p_budget:id,p_data:checked(data)});
  if(error)throw Error('H5G_CREATE_DENIED:'+error.message);
  if(!row||row.id!==id)throw Error('H5G_INVALID_CREATE_RESPONSE');
  return row;
 }
 async load(id){
  checkedId(id);const {data:row,error}=await this.client.rpc('h5b_load_draft',{p_id:id});
  if(error)throw Error('H5G_LOAD_DENIED:'+error.message);
  return row||null;
 }
 async save({id,expectedVersion,data,mutationId}){
  checkedId(id);checkedId(mutationId);
  if(!Number.isSafeInteger(expectedVersion)||expectedVersion<1)throw Error('INVALID_EXPECTED_VERSION');
  const {data:result,error}=await this.client.rpc('h5g_safe_edit',{
   p_budget:id,p_version:expectedVersion,p_data:checked(data),p_mutation:mutationId
  });
  if(error)throw Error('H5G_WRITE_DENIED:'+error.message);
  if(result?.status==='conflict')throw new VersionConflict(null);
  if(result?.status!=='saved'||!result.row||result.row.id!==id)throw Error('H5G_INVALID_SAVE_RESPONSE');
  return result.row;
 }
}
