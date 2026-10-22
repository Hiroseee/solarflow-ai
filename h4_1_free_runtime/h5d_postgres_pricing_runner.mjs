import {execFile} from 'node:child_process';
import {createServer} from 'node:http';
import pg from 'pg';
import {createClient} from '@supabase/supabase-js';
import {IsolatedPostgrestDraftAdapter} from '../src/h5-b/isolated-postgrest-adapter.mjs';
import {DraftController,MemoryDurableStore} from '../src/h5-b/draft-engine.mjs';
import {makeCatalog,chooseKit,addItem,setQuantity,removeItem,validateItems} from '../src/h5-c/commercial-items.mjs';
import {calculateDraft} from '../src/h5-d/pricing-engine.mjs';
const SQL="-- TEST FIXTURE ONLY. H5-B disposable Postgres/Auth/REST. NOT CANONICAL MIGRATION.\ncreate extension if not exists pgcrypto;\ncreate table public.h5b_drafts(id text primary key,owner_id uuid not null,version bigint not null default 1, data jsonb not null default '{}'::jsonb);\ncreate table public.h5b_receipts(draft_id text not null,mutation_id text not null, owner_id uuid not null,result jsonb not null, primary key(draft_id,mutation_id));\nalter table public.h5b_drafts enable row level security;\nalter table public.h5b_receipts enable row level security;\ncreate policy h5b_own_read on public.h5b_drafts for select to authenticated using(owner_id=(select auth.uid()));\ncreate policy h5b_own_insert on public.h5b_drafts for insert to authenticated with check(owner_id=(select auth.uid()));\ncreate policy h5b_own_update on public.h5b_drafts for update to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));\ngrant select,insert,update on public.h5b_drafts to authenticated;\n-- Strictly scoped SECURITY DEFINER only for atomic receipt+update; explicit uid check and empty search_path.\ncreate function public.h5b_create_draft(p_id text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $h5b$\ndeclare r public.h5b_drafts;\nbegin\n if auth.uid() is null then raise exception 'UNAUTHORIZED' using errcode='42501'; end if;\n insert into public.h5b_drafts(id,owner_id,data) values(p_id,auth.uid(),p_data) returning * into r;\n return jsonb_build_object('id',r.id,'version',r.version,'data',r.data);\nend $h5b$;\ncreate function public.h5b_load_draft(p_id text) returns jsonb language sql stable security invoker set search_path='' as $h5b$\n select jsonb_build_object('id',d.id,'version',d.version,'data',d.data)\n from public.h5b_drafts d where d.id=p_id and d.owner_id=(select auth.uid())\n$h5b$;\ncreate function public.h5b_save_draft(p_id text,p_expected bigint,p_data jsonb,p_mutation text) returns jsonb language plpgsql security definer set search_path='' as $h5b$\ndeclare existing public.h5b_receipts; current_row public.h5b_drafts; result jsonb;\nbegin\n if auth.uid() is null or p_mutation is null or length(p_mutation)<1 then raise exception 'UNAUTHORIZED_OR_EMPTY_MUTATION' using errcode='42501';end if;\n select * into current_row from public.h5b_drafts where id=p_id for update;\n if not found or current_row.owner_id<>auth.uid() then raise exception 'NOT_FOUND' using errcode='42501'; end if;\n select * into existing from public.h5b_receipts where draft_id=p_id and mutation_id=p_mutation;\n if found then\n   if existing.owner_id<>auth.uid() then raise exception 'RECEIPT_OWNER_MISMATCH' using errcode='42501';end if;\n   return jsonb_build_object('status','saved','row',existing.result);\n end if;\n if current_row.version<>p_expected then\n   return jsonb_build_object('status','conflict','current',jsonb_build_object('id',current_row.id,'version',current_row.version,'data',current_row.data));\n end if;\n update public.h5b_drafts set data=p_data, version=version+1 where id=p_id returning * into current_row;\n result=jsonb_build_object('id',current_row.id,'version',current_row.version,'data',current_row.data);\n insert into public.h5b_receipts(draft_id,mutation_id,owner_id,result) values(p_id,p_mutation,auth.uid(),result);\n return jsonb_build_object('status','saved','row',result);\nend $h5b$;\nrevoke all on function public.h5b_create_draft(text,jsonb) from public;\nrevoke all on function public.h5b_load_draft(text) from public;\nrevoke all on function public.h5b_save_draft(text,bigint,jsonb,text) from public;\ngrant execute on function public.h5b_create_draft(text,jsonb),public.h5b_load_draft(text),public.h5b_save_draft(text,bigint,jsonb,text) to authenticated;\n";
const S={phase:'STARTING',isolation:'NOT_PROVEN',tests:[],error:null};
const log=(...a)=>console.log('[H5D_PG]',...a),assert=(v,m)=>{if(!v)throw Error(m)},passed=n=>{S.tests.push(n);log('PASS',n)};
createServer((_q,r)=>{r.setHeader('content-type','application/json');r.end(JSON.stringify(S))}).listen(Number(process.env.PORT||10000),'0.0.0.0');
function run(args,ms=155000){return new Promise((resolve,reject)=>{log('BEGIN',args.join(' '));execFile('npx',['--no-install','supabase',...args],{env:{...process.env,SUPABASE_EXPERIMENTAL_STACK:'1'},timeout:ms,maxBuffer:4e6},(e,out,err)=>{log('END',args[0],e?'FAIL':'PASS');e?reject(Error(e.message+' '+(err||'').slice(-400))):resolve(out)})})}
(async()=>{let db;try{
assert(!Object.keys(process.env).some(k=>/SUPABASE_(ACCESS_TOKEN|DB_PASSWORD|SERVICE_ROLE_KEY)|BESS.*(SECRET|TOKEN|PASSWORD)|CRM.*(SECRET|TOKEN|PASSWORD)/i.test(k)),'SECRET_ENV_PRESENT');
await run(['init','--force'],45000);
await run(['start','--runtime','native','--preparation','on-demand','--exclude','realtime,storage,functions,studio,mail,analytics,pooler'],155000);
const raw=await run(['status','--output-format','json'],45000),j=JSON.parse(raw.slice(raw.indexOf('{'),raw.lastIndexOf('}')+1));
assert(j.runtime==='native'&&!JSON.stringify(j).includes('supabase.co'),'REMOTE_RUNTIME');
const dbUrl=j.env?.DB_URL||j.endpoints?.database?.sql?.url,api=j.env?.API_URL||j.endpoints?.api?.url||j.endpoints?.rest?.url;
assert(dbUrl&&api&&['127.0.0.1','localhost'].includes(new URL(dbUrl).hostname)&&['127.0.0.1','localhost'].includes(new URL(api).hostname),'REMOTE_ENDPOINT');
const anon=j.env?.ANON_KEY||j.env?.PUBLISHABLE_KEY,service=j.env?.SERVICE_ROLE_KEY||j.env?.SECRET_KEY;assert(anon&&service,'NO_LOCAL_KEYS');
db=new pg.Client({connectionString:dbUrl,connectionTimeoutMillis:12000});await db.connect();await db.query('select 1');S.isolation='PASS';log('ISOLATION_PASS');
await db.query(SQL);passed('postgres_sql_fixture');
const admin=createClient(api,service,{auth:{persistSession:false,autoRefreshToken:false}});
const users=[];for(let i=0;i<2;i++){const email='h5b-'+i+'-'+Date.now()+'@example.test';const {data,error}=await admin.auth.admin.createUser({email,password:'FixtureLocalOnly!234',email_confirm:true});assert(!error&&data?.user?.id,'AUTH_CREATE_'+error?.message);const c=createClient(api,anon,{auth:{persistSession:false,autoRefreshToken:false}});const session=await c.auth.signInWithPassword({email,password:'FixtureLocalOnly!234'});assert(!session.error,'AUTH_LOGIN_'+session.error?.message);users.push(c)}passed('auth_real_jwt');
const [a,b]=users.map(c=>new IsolatedPostgrestDraftAdapter(c));
const id='fixture-'+Date.now(),initial=await a.create(id,{client:'Original'});assert(initial.version===1,'CREATE_VERSION');assert((await a.load(id)).data.client==='Original','PERSIST_READ');passed('create_and_reload_real_pg');
assert(await b.load(id)===null,'CROSS_OWNER_READ');let denied=false;try{await b.save({id,expectedVersion:1,data:{client:'attack'},mutationId:'foreign'})}catch(e){denied=true}assert(denied,'CROSS_OWNER_WRITE');passed('rls_cross_owner_denied');
const local=new MemoryDurableStore(),controller=new DraftController({id,adapter:a,durableStore:local,mutationIds:(()=>{let i=0;return ()=>'mut-'+(++i)})()});
await controller.initialize();await controller.edit({client:'Edited'});await controller.flush();assert(controller.view().status==='saved','CONTROLLER_SAVED');assert((await a.load(id)).data.client==='Edited','AUTOSAVE_NOT_PERSISTED');passed('controller_postgres_autosave');
const dup={id,expectedVersion:1,data:{client:'Edited'},mutationId:'mut-1'};
const receipt=await a.save(dup);assert(receipt.version===2,'RECEIPT_FAILED');assert((await a.load(id)).version===2,'DUPLICATE_VERSION');passed('idempotent_receipt_retry');
const another=new IsolatedPostgrestDraftAdapter(users[0]);const both=await Promise.allSettled([
a.save({id,expectedVersion:2,data:{a:1},mutationId:'race-a'}),
another.save({id,expectedVersion:2,data:{b:2},mutationId:'race-b'})]);assert(both.filter(x=>x.status==='fulfilled').length===1&&both.filter(x=>x.status==='rejected'&&x.reason.code==='VERSION_CONFLICT').length===1,'CONCURRENCY_MUST_HAVE_EXACTLY_ONE_WINNER');passed('real_concurrent_clients_version_conflict');
const after=await a.load(id);assert(after.version===3,'AFTER_RACE_VERSION');passed('refresh_reads_latest_pg');
let once=true;const lost={load:x=>a.load(x),save:async req=>{const res=await a.save(req);if(once){once=false;throw Error('RESPONSE_LOST_AFTER_COMMIT')}return res}};
const recover=new DraftController({id,adapter:lost,durableStore:new MemoryDurableStore(),mutationIds:()=> 'lost-ack'});await recover.initialize();await recover.edit({refreshed:true});await recover.flush();assert(recover.view().status==='retryable_error','NETWORK_ERROR_STATE');await recover.retry();assert(recover.view().status==='saved','RETRY_FAILED');assert((await a.load(id)).version===4,'RESPONSE_LOSS_DOUBLE_WRITE');passed('lost_response_real_db_exactly_once');

const catalog=makeCatalog([
{id:'fictional-inverter',category:'inverter',label:'Fictitious inverter'},
{id:'fictional-bess',category:'bess',label:'Fictitious BESS'},
{id:'fictional-module',category:'module',label:'Fictitious solar module'},
{id:'fictional-acc',category:'accessory',label:'Fictitious BESS accessory'}
]);
const compId='h5c-'+Date.now();
let draft=chooseKit({client:'Fixture only',kitChoice:null,items:[]},'12kw');
draft=addItem(draft,catalog,{productId:'fictional-inverter',lineId:'inv-1',quantity:1});
draft=addItem(draft,catalog,{productId:'fictional-bess',lineId:'bess-1',quantity:1});
draft=addItem(draft,catalog,{productId:'fictional-module',lineId:'mod-1',quantity:20});
draft=addItem(draft,catalog,{productId:'fictional-acc',lineId:'acc-1',quantity:2,relatedBessLineId:'bess-1'});
assert(validateItems(draft.items,catalog),'INVALID_ITEM_SELECTION');
const created=await a.create(compId,draft);assert(created.version===1,'COMPOSITION_CREATE_FAILED');
const cc=new DraftController({id:compId,adapter:a,durableStore:new MemoryDurableStore(),mutationIds:(()=>{let n=0;return ()=>'h5c-mutation-'+(++n)})()});
await cc.initialize();await cc.edit(setQuantity(cc.view().data,catalog,'mod-1',28));
await cc.flush();assert(cc.view().status==='saved','COMPOSITION_AUTOSAVE_FAILED');
let persisted=await a.load(compId);assert(persisted.version===2&&persisted.data.items.find(x=>x.lineId==='mod-1').quantity===28,'COMPOSITION_NOT_PERSISTED');passed('h5c_real_pg_kit_products_accessory_autosave');
assert(persisted.data.items.find(x=>x.lineId==='acc-1').relatedBessLineId==='bess-1','BESS_PARENT_LINK_LOST');
assert(persisted.data.items.every(x=>['inv-1','bess-1','mod-1','acc-1'].includes(x.lineId)),'LINE_IDS_DIVERGED');passed('h5c_item_identity_accessory_link_reload');
let forbidden=false;try{await b.save({id:compId,expectedVersion:2,data:{items:[]},mutationId:'h5c-hijack'});}catch(e){forbidden=true};assert(forbidden,'OTHER_SELLER_MUTATED_KIT');assert(await b.load(compId)===null,'OTHER_SELLER_READ_KIT');passed('h5c_real_jwt_ownership_denied');
const racingA=setQuantity(persisted.data,catalog,'mod-1',30),racingB=addItem(persisted.data,catalog,{productId:'fictional-module',lineId:'mod-2',quantity:3});
const outcomes=await Promise.allSettled([
a.save({id:compId,expectedVersion:2,data:racingA,mutationId:'h5c-race-quantity'}),
new IsolatedPostgrestDraftAdapter(users[0]).save({id:compId,expectedVersion:2,data:racingB,mutationId:'h5c-race-add'})
]);
assert(outcomes.filter(x=>x.status==='fulfilled').length===1,'MUST_HAVE_ONE_WINNER');
assert(outcomes.filter(x=>x.status==='rejected'&&x.reason.code==='VERSION_CONFLICT').length===1,'MUST_REJECT_ONE_STALE_WRITER');
persisted=await a.load(compId);assert(persisted.version===3&&validateItems(persisted.data.items,catalog),'RACE_CORRUPTED_ITEMS');passed('h5c_two_real_pg_sessions_conflict_no_silent_merge');
const update=removeItem(persisted.data,catalog,'acc-1');
let drop=true;const transport={load:k=>a.load(k),save:async r=>{const response=await a.save(r);if(drop){drop=false;throw Error('INJECTED_POST_COMMIT_LOSS')}return response}};
const cRecover=new DraftController({id:compId,adapter:transport,durableStore:new MemoryDurableStore(),mutationIds:()=>'h5c-lost'});
await cRecover.initialize();await cRecover.edit(update);await cRecover.flush();assert(cRecover.view().status==='retryable_error','LOST_ACK_NOT_RECOGNIZED');
await cRecover.retry();assert(cRecover.view().status==='saved','LOST_ACK_RETRY_FAILED');
persisted=await a.load(compId);assert(persisted.version===4&&!persisted.data.items.some(x=>x.lineId==='acc-1'),'REMOVAL_NOT_DURABLE');passed('h5c_item_removal_retry_exactly_once_real_pg');
const reload=new DraftController({id:compId,adapter:a,durableStore:new MemoryDurableStore(),mutationIds:()=> 'h5c-reload'});
await reload.initialize();assert(reload.view().data.items.find(x=>x.lineId==='bess-1'),'BESS_NOT_RECOVERED');assert(reload.view().version===4,'RELOAD_VERSION_MISMATCH');passed('h5c_reload_new_controller_pg');


const finId='h5d-'+Date.now();
let finance=chooseKit({client:'Fixture',items:[]},'15kw');
finance=addItem(finance,catalog,{productId:'fictional-inverter',lineId:'inv-fin',quantity:1});
finance=addItem(finance,catalog,{productId:'fictional-module',lineId:'mod-fin',quantity:4});
finance.pricing={unitPrices:{'fictional-inverter':100000,'fictional-module':11250},freight:{incoterm:'CIF',mode:'manual',cents:6500}};
await a.create(finId,finance);
const editor=new DraftController({id:finId,adapter:a,durableStore:new MemoryDurableStore(),mutationIds:()=> 'h5d-1'});
await editor.initialize();assert(calculateDraft(editor.view().data,catalog,editor.view().data.pricing).totalCents===151500,'FINANCIAL_TOTAL_BAD');
await editor.edit({pricing:{...finance.pricing,freight:{incoterm:'FOB',mode:'none'}}});await editor.flush();
const loaded=await a.load(finId),total=calculateDraft(loaded.data,catalog,loaded.data.pricing);assert(loaded.version===2&&total.totalCents===145000,'FINANCIAL_RELOAD_INCONSISTENT');passed('h5d_real_pg_pricing_recompute');
assert(calculateDraft({...loaded.data,totalCents:1},catalog,loaded.data.pricing).totalCents===145000,'TAMPERED_CLIENT_TOTAL_TRUSTED');passed('h5d_tampered_total_ignored');
let deniedPrice=false;try{await b.save({id:finId,expectedVersion:2,data:{pricing:{}},mutationId:'steal'})}catch{deniedPrice=true};assert(deniedPrice&&(await b.load(finId))===null,'OWNER_PRICE_TAMPER');passed('h5d_real_jwt_owner_denied');
const priceRace=await Promise.allSettled([a.save({id:finId,expectedVersion:2,data:{...loaded.data,pricing:{...finance.pricing,freight:{incoterm:'CIF',mode:'manual',cents:7000}}},mutationId:'h5d-race-a'}),new IsolatedPostgrestDraftAdapter(users[0]).save({id:finId,expectedVersion:2,data:{...loaded.data,pricing:{...finance.pricing,freight:{incoterm:'FOB',mode:'none'}}},mutationId:'h5d-race-b'})]);assert(priceRace.filter(x=>x.status==='fulfilled').length===1&&priceRace.filter(x=>x.status==='rejected'&&x.reason.code==='VERSION_CONFLICT').length===1,'FINANCIAL_RACE');passed('h5d_real_price_concurrency_conflict');
S.phase='PASS';log('FINAL',JSON.stringify(S));
}catch(e){S.phase='FAIL';S.error=e.message;log('FINAL',JSON.stringify(S));}finally{if(db)await db.end().catch(()=>{})}})();
