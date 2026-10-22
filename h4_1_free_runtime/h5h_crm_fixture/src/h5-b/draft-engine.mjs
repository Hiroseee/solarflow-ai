// H5-B isolated draft engine. No browser, network or canonical DB dependency.
// Persist adapter contract: load(id) => {id,version,data}|null; save({id,expectedVersion,data,mutationId}) => same.
// Atomic idempotency and optimistic concurrency are adapter responsibilities.
export class VersionConflict extends Error { constructor(current){super('VERSION_CONFLICT');this.code='VERSION_CONFLICT';this.current=current;} }
export class UncertainWrite extends Error { constructor(){super('UNCERTAIN_WRITE');this.code='UNCERTAIN_WRITE';} }
export class MemoryDraftAdapter {
  #rows=new Map();#receipts=new Map();
  async create(id,data={}){if(this.#rows.has(id))throw Error('DUPLICATE_DRAFT');const v={id,version:1,data:structuredClone(data)};this.#rows.set(id,v);return structuredClone(v);}
  async load(id){const v=this.#rows.get(id);return v?structuredClone(v):null;}
  async save({id,expectedVersion,data,mutationId}){
    if(!mutationId)throw Error('MISSING_MUTATION_ID');
    const key=id+'|'+mutationId,receipt=this.#receipts.get(key);
    if(receipt)return structuredClone(receipt);
    const cur=this.#rows.get(id);if(!cur)throw Error('NOT_FOUND');
    if(cur.version!==expectedVersion)throw new VersionConflict(structuredClone(cur));
    const next={id,version:cur.version+1,data:structuredClone(data)};
    this.#rows.set(id,next);this.#receipts.set(key,next);return structuredClone(next);
  }
}
export class DraftController {
  constructor({id,adapter,durableStore,debounceMs=350,scheduler={set:(fn,ms)=>setTimeout(fn,ms),clear:clearTimeout},mutationIds}){
    this.id=id;this.adapter=adapter;this.store=durableStore;this.wait=debounceMs;this.scheduler=scheduler;
    this.ids=mutationIds||(()=>globalThis.crypto.randomUUID());
    this.status='loading';this.data={};this.version=null;this.error=null;this.pending=null;this.timer=null;this.inFlight=false;this.listeners=new Set();
  }
  subscribe(listener){this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
  #emit(){for(const fn of this.listeners)fn(this.view());}
  view(){return {status:this.status,version:this.version,data:structuredClone(this.data),error:this.error?.message||null,pending:!!this.pending};}
  async initialize(){const remote=await this.adapter.load(this.id);if(!remote)throw Error('NOT_FOUND');this.version=remote.version;const local=await this.store.read(this.id);
    if(local){this.data=structuredClone(local.data);this.pending=local;this.status='unsaved';}
    else {this.data=structuredClone(remote.data);this.status='saved';}this.#emit();return this.view();}
  async edit(patch){if(this.version===null)throw Error('NOT_INITIALIZED');this.data={...this.data,...structuredClone(patch)};
    if(this.pending && !this.inFlight){this.pending.data=structuredClone(this.data);}
    else if(this.pending && this.inFlight){this.pending={id:this.id,expectedVersion:this.version,data:structuredClone(this.data),mutationId:this.ids()};}
    else this.pending={id:this.id,expectedVersion:this.version,data:structuredClone(this.data),mutationId:this.ids()};
    await this.store.write(this.id,this.pending);this.status='unsaved';this.error=null;this.#emit();this.#schedule();return this.view();}
  #schedule(){if(this.timer!==null)this.scheduler.clear(this.timer);this.timer=this.scheduler.set(()=>{this.timer=null;void this.flush();},this.wait);}
  async flush(){if(this.timer!==null){this.scheduler.clear(this.timer);this.timer=null;}
    if(this.inFlight||!this.pending)return this.view();this.inFlight=true;
    const request=structuredClone(this.pending);this.status='saving';this.#emit();
    try{const saved=await this.adapter.save(request);
      this.version=saved.version;
      if(this.pending?.mutationId===request.mutationId){
        this.pending=null;await this.store.remove(this.id);this.status='saved';
      }else{this.pending.expectedVersion=saved.version;await this.store.write(this.id,this.pending);this.status='unsaved';this.#schedule();}
      this.error=null;
    }catch(e){this.error=e;this.status=e.code==='VERSION_CONFLICT'?'conflict':'retryable_error';
      // Crucial: retain SAME mutationId for lost responses; do not write over concurrent changes.
      await this.store.write(this.id,this.pending);
    }finally{this.inFlight=false;this.#emit();}
    return this.view();
  }
  async retry(){if(!this.pending)return this.view();return this.flush();}
  async acceptServer(){const saved=await this.adapter.load(this.id);if(!saved)throw Error('NOT_FOUND');
    this.version=saved.version;this.data=structuredClone(saved.data);this.pending=null;
    await this.store.remove(this.id);this.status='saved';this.error=null;this.#emit();return this.view();}
}
export class MemoryDurableStore {
  #data=new Map();
  async read(id){return structuredClone(this.#data.get(id)||null);}
  async write(id,value){this.#data.set(id,structuredClone(value));}
  async remove(id){this.#data.delete(id);}
}
