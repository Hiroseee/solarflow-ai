import {createHash} from 'node:crypto';
import {verifyFixtureSnapshot} from './fixture-snapshot.mjs';
const copy=x=>structuredClone(x);
export class PrivateFixtureStore{
 #objects=new Map();
 async put(path,bytes,{ownerId,mutationId}={}){if(!ownerId||!mutationId||!/^[a-z0-9_-]+\/[a-z0-9_-]+\/[a-z0-9_-]+\.pdf$/i.test(path))throw Error('INVALID_PRIVATE_PATH');
 const existing=this.#objects.get(path),buffer=Buffer.from(bytes),digest=createHash('sha256').update(buffer).digest('hex');
 if(existing){if(existing.ownerId===ownerId&&existing.mutationId===mutationId&&existing.sha256===digest)return copy({path,sha256:digest});throw Error('PRIVATE_OBJECT_ALREADY_EXISTS');}
 this.#objects.set(path,{bytes:buffer,ownerId,mutationId,sha256:digest});return {path,sha256:digest};
 }
 async get(path,{ownerId}={}){const value=this.#objects.get(path);if(!value||value.ownerId!==ownerId)throw Error('PRIVATE_OBJECT_ACCESS_DENIED');const bytes=Buffer.from(value.bytes);if(createHash('sha256').update(bytes).digest('hex')!==value.sha256)throw Error('PRIVATE_OBJECT_CORRUPTED');return bytes;}
 async remove(path,{ownerId,mutationId}={}){const value=this.#objects.get(path);if(!value||value.ownerId!==ownerId||value.mutationId!==mutationId)throw Error('PRIVATE_OBJECT_ACCESS_DENIED');this.#objects.delete(path);}
}
export class FixtureRevisionLedger{
 #rows=new Map();#byMutation=new Map();#locks=new Map();
 async record({budgetId,revisionId,mutationId,ownerId,snapshot,pdf,store}){
 if(!budgetId||!ownerId||!revisionId||!mutationId)throw Error('INVALID_REVISION_ID');
 verifyFixtureSnapshot(snapshot);
 if(snapshot.budgetId!==budgetId||snapshot.revisionId!==revisionId||snapshot.mutationId!==mutationId)throw Error('SNAPSHOT_REFERENCE_MISMATCH');
 const key=budgetId+'/'+revisionId,receipt=budgetId+'/'+mutationId,path=ownerId+'/'+budgetId+'/'+revisionId+'.pdf';
 // In-process fixture serialization only: not a distributed transaction or canonical revision numbering policy.
 const previous=this.#locks.get(budgetId)||Promise.resolve();let unlock;const next=new Promise(resolve=>unlock=resolve);this.#locks.set(budgetId,next);
 await previous;
 try{const existing=this.#byMutation.get(receipt);if(existing){if(existing.ownerId!==ownerId||existing.revisionId!==revisionId||existing.snapshot.integritySha256!==snapshot.integritySha256)throw Error('MUTATION_CONFLICT');return copy(existing);}
 if(this.#rows.has(key))throw Error('REVISION_ALREADY_EXISTS');
 const buffer=Buffer.from(pdf);if(buffer.subarray(0,5).toString()!=='%PDF-')throw Error('INVALID_PDF');
 await store.put(path,buffer,{ownerId,mutationId});
 try{const row={budgetId,revisionId,mutationId,ownerId,path,snapshot:copy(snapshot),pdfSha256:createHash('sha256').update(buffer).digest('hex'),state:'FIXTURE_STORED_NOT_ISSUED'};
 this.#rows.set(key,row);this.#byMutation.set(receipt,row);return copy(row);
 }catch(e){await store.remove(path,{ownerId,mutationId});throw e}
 }finally{unlock();if(this.#locks.get(budgetId)===next)this.#locks.delete(budgetId);}
 }
 get(budgetId,revisionId,{ownerId}={}){const row=this.#rows.get(budgetId+'/'+revisionId);if(!row||row.ownerId!==ownerId)throw Error('REVISION_ACCESS_DENIED');return copy(row);}
 list(budgetId,{ownerId}={}){return [...this.#rows.values()].filter(x=>x.budgetId===budgetId&&x.ownerId===ownerId).map(copy);}
}
