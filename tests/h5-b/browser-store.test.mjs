import test from 'node:test';import assert from 'node:assert/strict';
import {WebStorageDraftStore,attachReconnectRetry} from '../../src/h5-b/browser-draft-store.mjs';
import {DraftController,MemoryDraftAdapter} from '../../src/h5-b/draft-engine.mjs';
class Storage{m=new Map();getItem(k){return this.m.has(k)?this.m.get(k):null;}setItem(k,v){this.m.set(k,v);}removeItem(k){this.m.delete(k);}}
test('reload from durable storage into new controller, then commit once',async()=>{
 const memory=new Storage(),server=new MemoryDraftAdapter();await server.create('budget',{client:'A'});
 const c=new DraftController({id:'budget',adapter:server,durableStore:new WebStorageDraftStore(memory),mutationIds:()=> 'request1'});await c.initialize();await c.edit({client:'B'});
 const c2=new DraftController({id:'budget',adapter:server,durableStore:new WebStorageDraftStore(memory),mutationIds:()=> 'request2'});await c2.initialize();
 assert.equal(c2.view().status,'unsaved');assert.equal(c2.view().data.client,'B');await c2.flush();assert.equal(c2.view().status,'saved');assert.equal((await server.load('budget')).version,2);assert.equal(await new WebStorageDraftStore(memory).read('budget'),null);
});
test('reconnect invokes retry after simulated network failure',async()=>{
 const memory=new Storage(),server=new MemoryDraftAdapter();await server.create('budget2',{});let fail=true;
 const adapter={load:(...a)=>server.load(...a),save:async x=>{if(fail){fail=false;throw Error('offline')}return server.save(x)}};
 const c=new DraftController({id:'budget2',adapter,durableStore:new WebStorageDraftStore(memory),mutationIds:()=>'reconnect-1'});await c.initialize();await c.edit({note:'queued'});await c.flush();assert.equal(c.view().status,'retryable_error');
 let cb;const events={addEventListener:(_,h)=>{cb=h;},removeEventListener:()=>{cb=null;}};const detach=attachReconnectRetry(c,events);cb();await new Promise(r=>setImmediate(r));assert.equal(c.view().status,'saved');detach();assert.equal(cb,null);
});
test('reject corrupted outbox and wrong draft identity',async()=>{const s=new Storage(),store=new WebStorageDraftStore(s);await assert.rejects(store.write('x',{id:'y'}),/DRAFT_ID_MISMATCH/);s.setItem('crm-h5b-draft:x','{}');await assert.rejects(store.read('x'),/INVALID_STORED_DRAFT/);});
