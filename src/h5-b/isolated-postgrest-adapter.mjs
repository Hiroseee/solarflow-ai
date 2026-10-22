// H5-B isolated PostgREST adapter: requires a real authenticated Supabase client.
// RPC functions and fixtures are test-only until H5-A canonical reconciliation passes.
import {VersionConflict} from './draft-engine.mjs';
export class IsolatedPostgrestDraftAdapter {
 constructor(client){this.client=client;}
 async create(id,data={}){const {data:row,error}=await this.client.rpc('h5b_create_draft',{p_id:id,p_data:data});if(error)throw new Error('CREATE_FAILED:'+error.message);return row;}
 async load(id){const {data:row,error}=await this.client.rpc('h5b_load_draft',{p_id:id});if(error)throw new Error('LOAD_FAILED:'+error.message);return row;}
 async save({id,expectedVersion,data,mutationId}){
   if(!mutationId)throw Error('MISSING_MUTATION_ID');
   const {data:result,error}=await this.client.rpc('h5b_save_draft',{p_id:id,p_expected:expectedVersion,p_data:data,p_mutation:mutationId});
   if(error)throw new Error('SAVE_FAILED:'+error.message);
   if(result?.status==='conflict')throw new VersionConflict(result.current);
   if(result?.status!=='saved'||!result.row)throw Error('INVALID_RPC_RESPONSE');
   return result.row;
 }
}
