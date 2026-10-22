// Browser-side durable adapter. Inject a Storage-compatible object (e.g. window.localStorage).
// No canonical DB or network access; isolated H5-B boundary.
export class WebStorageDraftStore {
 constructor(storage,{prefix='crm-h5b-draft:'}={}){if(!storage||typeof storage.getItem!=='function'||typeof storage.setItem!=='function'||typeof storage.removeItem!=='function')throw Error('STORAGE_REQUIRED');this.storage=storage;this.prefix=prefix;}
 async read(id){const raw=this.storage.getItem(this.prefix+id);if(raw===null)return null;const parsed=JSON.parse(raw);if(!parsed||parsed.id!==id||!parsed.mutationId||!Number.isInteger(parsed.expectedVersion))throw Error('INVALID_STORED_DRAFT');return parsed;}
 async write(id,value){if(value.id!==id)throw Error('DRAFT_ID_MISMATCH');this.storage.setItem(this.prefix+id,JSON.stringify(value));}
 async remove(id){this.storage.removeItem(this.prefix+id);}
}
export function attachReconnectRetry(controller,events){
 if(!events||typeof events.addEventListener!=='function'||typeof events.removeEventListener!=='function')throw Error('EVENT_TARGET_REQUIRED');
 const handler=()=>{if(controller.view().status==='retryable_error')void controller.retry();};
 events.addEventListener('online',handler);
 return ()=>events.removeEventListener('online',handler);
}
