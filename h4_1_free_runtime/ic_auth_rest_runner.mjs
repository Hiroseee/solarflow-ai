import {execFile} from 'node:child_process';
import {createServer} from 'node:http';
import pg from 'pg';import {createClient} from '@supabase/supabase-js';
const S={phase:'BOOT',isolation:'NOT_PROVEN',I:'PENDING',C:'PENDING',results:{},error:null};
createServer((_q,r)=>{r.setHeader('content-type','application/json');r.end(JSON.stringify(S))}).listen(Number(process.env.PORT||10000),'0.0.0.0');
const log=(...x)=>console.log('[H41_IC]',...x);const check=(v,m)=>{if(!v)throw Error(m)};
function run(a,ms=140000){return new Promise((ok,bad)=>{log('BEGIN',a.join(' '));const t=Date.now();execFile('npx',['--no-install','supabase',...a],{env:{...process.env,SUPABASE_EXPERIMENTAL_STACK:'1'},timeout:ms,maxBuffer:3e6},(e,o,er)=>{log('END',a[0],Date.now()-t,e?'FAIL':'PASS');e?bad(Error(e.message+' '+(er||'').slice(-500))):ok(o)})})}
(async()=>{let db;try{
 check(!Object.keys(process.env).some(k=>/SUPABASE_(ACCESS_TOKEN|DB_PASSWORD|SERVICE_ROLE_KEY)|BESS.*(SECRET|TOKEN|PASSWORD)|CRM.*(SECRET|TOKEN|PASSWORD)/i.test(k)),'SENSITIVE_ENV_PRESENT');
 await run(['init','--force'],45000);
 await run(['start','--runtime','native','--preparation','on-demand','--exclude','realtime,storage,functions,studio,mail,analytics,pooler'],150000);
 const raw=await run(['status','--output-format','json'],45000);const j=JSON.parse(raw.slice(raw.indexOf('{'),raw.lastIndexOf('}')+1));
 check(j.runtime==='native'&&!JSON.stringify(j).includes('supabase.co'),'NON_ISOLATED_STATUS');
 const dbUrl=j.env?.DB_URL||j.endpoints?.database?.sql?.url;const api=j.env?.API_URL||j.endpoints?.api?.url||j.endpoints?.rest?.url;
 check(!!dbUrl&&!!api,'NATIVE_DB_OR_API_NOT_REPORTED');
 check(['127.0.0.1','localhost'].includes(new URL(dbUrl).hostname),'DB_NOT_LOCAL');
 check(['127.0.0.1','localhost'].includes(new URL(api).hostname),'API_NOT_LOCAL');
 const anon=j.env?.ANON_KEY||j.env?.PUBLISHABLE_KEY;const service=j.env?.SERVICE_ROLE_KEY||j.env?.SECRET_KEY;
 check(anon&&service,'LOCAL_TEST_JWT_MISSING');S.isolation='PASS';log('ISOLATION_PASS');
 db=new pg.Client({connectionString:dbUrl,connectionTimeoutMillis:12000});await db.connect();await db.query('select 1');
 const admin=createClient(api,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const seller1=createClient(api,anon,{auth:{persistSession:false,autoRefreshToken:false}});const seller2=createClient(api,anon,{auth:{persistSession:false,autoRefreshToken:false}});
 const buyer=createClient(api,anon,{auth:{persistSession:false,autoRefreshToken:false}});
 const users={};for(const role of ['seller','other','admin','director']){const email='h41-'+role+'-'+Date.now()+'@example.test';const {data,error}=await admin.auth.admin.createUser({email,password:'LocalFixturePassword!234',email_confirm:true});check(!error&&data?.user?.id,'LOCAL_AUTH_USER_FAIL_'+role+':'+error?.message);users[role]={id:data.user.id,email}}
 S.results.auth_users=4;log('AUTH_USERS_PASS');
 await db.query('create extension if not exists pgcrypto');
 await db.query("create table h41_ic_roles(id uuid primary key, role text not null)");
 await db.query("create table h41_ic_budgets(id uuid primary key default gen_random_uuid(),seller_id uuid not null,version int not null default 1,note text not null default '',updated_at timestamptz default now())");
 await db.query("create table h41_ic_revisions(id uuid primary key default gen_random_uuid(),budget_id uuid references h41_ic_budgets(id),snapshot jsonb not null)");
 await db.query("alter table h41_ic_budgets enable row level security");
 await db.query("create policy h41_ic_select on h41_ic_budgets for select to authenticated using (seller_id=auth.uid() or exists(select 1 from h41_ic_roles r where r.id=auth.uid() and r.role in ('admin','director')))");
 await db.query("create policy h41_ic_update on h41_ic_budgets for update to authenticated using (seller_id=auth.uid() or exists(select 1 from h41_ic_roles r where r.id=auth.uid() and r.role in ('admin','director'))) with check (seller_id=auth.uid() or exists(select 1 from h41_ic_roles r where r.id=auth.uid() and r.role in ('admin','director')))");
 await db.query("grant select,update on h41_ic_budgets to authenticated");await db.query("grant select on h41_ic_roles to authenticated");
 for(const role of ['seller','other','admin','director'])await db.query("insert into h41_ic_roles(id,role) values($1,$2)",[users[role].id,role==='other'?'seller':role]);
 const a=(await db.query('insert into h41_ic_budgets(seller_id,note) values($1,$2) returning id',[users.seller.id,'draft-original'])).rows[0].id;
 const b=(await db.query('insert into h41_ic_budgets(seller_id,note) values($1,$2) returning id',[users.other.id,'private'])).rows[0].id;
 async function session(role){const c=createClient(api,anon,{auth:{persistSession:false,autoRefreshToken:false}});const {data,error}=await c.auth.signInWithPassword({email:users[role].email,password:'LocalFixturePassword!234'});check(!error&&data?.session?.access_token,'LOGIN_FAIL_'+role+':'+error?.message);return c}
 const [own,other,administrator,director]=await Promise.all(['seller','other','admin','director'].map(session));
 async function records(c){const {data,error}=await c.from('h41_ic_budgets').select('id,seller_id,version,note');check(!error,'REST_READ_FAIL:'+error?.message);return data}
 let rows=await records(own);check(rows.some(x=>x.id===a)&&rows.every(x=>x.id!==b),'SELLER_CROSS_READ');
 rows=await records(other);check(rows.some(x=>x.id===b)&&rows.every(x=>x.id!==a),'OTHER_CROSS_READ');
 check((await records(administrator)).length===2,'ADMIN_READ');check((await records(director)).length===2,'DIRECTOR_READ');
 const anonRes=await fetch(api+'/rest/v1/h41_ic_budgets?select=id',{headers:{apikey:anon,Authorization:'Bearer '+anon}});const anonBody=await anonRes.text();check(!anonRes.ok||!anonBody.includes(a),'ANONYMOUS_READ_BYPASS');
 const fail=await other.from('h41_ic_budgets').update({note:'attack'}).eq('id',a).select();check(!fail.error&&(fail.data||[]).length===0,'CROSS_UPDATE');
 const saved=await own.from('h41_ic_budgets').update({note:'autosaved',version:2}).eq('id',a).eq('version',1).select();check(!saved.error&&saved.data.length===1,'SELLER_SAVE');
 const conflict=await own.from('h41_ic_budgets').update({note:'stale',version:3}).eq('id',a).eq('version',1).select();check(!conflict.error&&conflict.data.length===0,'STALE_NOT_BLOCKED');
 S.I='PASS_ISOLATED_AUTH_REST_RLS_FIXTURE';S.results.I={real_local_auth:true,rest:true,seller_isolation:true,admin_director_read:true,unauthorized_denied:true};log('GATE_I_PASS');
 const reload=await records(own);check(reload.find(x=>x.id===a)?.note==='autosaved','RECOVERY_READ_FAIL');
 await db.query("update h41_ic_budgets set note='recovered',version=3 where id=$1 and version=2",[a]);
 const verify=await records(own);check(verify.find(x=>x.id===a)?.note==='recovered','RECOVERY_FAIL');
 const rev=await db.query('select count(*)::int c from h41_ic_revisions');check(rev.rows[0].c===0,'AUTOSAVE_CREATED_REVISION');
 S.C='PARTIAL_INTEGRATED_PERSISTENCE';S.results.C={save:true,reload:true,stale_rejected:true,recovery:true,no_revision:true,missing:['network-failure injected','client debounce and retry policy','persisted outbox retry']};log('GATE_C_PARTIAL');
 S.phase='COMPLETE';
}catch(e){S.error=e.message;S.phase='FAIL';log('FAIL',e.message)}finally{if(db)await db.end().catch(()=>{});log('FINAL',JSON.stringify(S));}})();
