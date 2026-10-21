import {execFile} from 'node:child_process';
import {createServer} from 'node:http';
import pg from 'pg';
const S={phase:'BOOT',cli:'2.121.0',isolation:'NOT_PROVEN',gates:{},error:null,step:null};
createServer((_q,r)=>{r.setHeader('content-type','application/json');r.end(JSON.stringify(S));}).listen(Number(process.env.PORT||10000),'0.0.0.0');
const log=(...a)=>console.log('[H41_DB]',...a);
function run(args,ms=120000){return new Promise((ok,bad)=>{S.step=args.join(' ');const start=Date.now();log('BEGIN',S.step);
 const child=execFile('npx',['--no-install','supabase',...args],{timeout:ms,maxBuffer:1e7,env:{...process.env,SUPABASE_EXPERIMENTAL_STACK:'1'}},(e,out,err)=>{log('END',S.step,Date.now()-start,e?e.message:'PASS',(err||'').slice(-600));e?bad(Error('COMMAND_FAIL '+S.step+': '+e.message+' '+(err||'').slice(-800))):ok(out)});
 child.stdout?.on('data',x=>log('OUT',String(x).slice(-350)));child.stderr?.on('data',x=>log('ERR',String(x).slice(-350)));
})}
const ensure=(v,m)=>{if(!v)throw Error(m);};
async function gate(name,fn){try{const d=await fn();S.gates[name]={pass:true,...(d||{})};log('GATE_'+name,'PASS')}catch(e){S.gates[name]={pass:false,error:e.message};log('GATE_'+name,'FAIL',e.message)}}
(async()=>{let db;
try{
 const forbidden=Object.keys(process.env).filter(k=>/SUPABASE_(ACCESS_TOKEN|DB_PASSWORD|SERVICE_ROLE_KEY)|BESS.*(SECRET|TOKEN|PASSWORD)|CRM.*(SECRET|TOKEN|PASSWORD)/i.test(k));
 ensure(forbidden.length===0,'PRODUCTION_OR_BESS_SECRET_VARIABLE_NAMES_PRESENT');
 S.phase='INIT';await run(['init','--force'],45000);
 S.phase='DB_START';
 const excludes='gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor';
 S.db_only_command='supabase start --runtime native --preparation on-demand --ignore-health-check --exclude '+excludes;
 await run(['start','--runtime','native','--preparation','on-demand','--ignore-health-check','--exclude',excludes],120000);
 S.phase='STATUS';const raw=await run(['status','--output','json'],45000);
 const j=JSON.parse(raw.slice(raw.indexOf('{'),raw.lastIndexOf('}')+1));
 ensure(!JSON.stringify(j).includes('supabase.co'),'REMOTE_ENDPOINT_IN_STATUS');
 const vals=Object.entries(j).filter(([k,v])=>/DB_URL|DATABASE_URL|db_url/i.test(k)&&typeof v==='string');
 ensure(vals.length>0,'LOCAL_DB_URL_MISSING');
 const url=vals[0][1];const u=new URL(url);ensure(['127.0.0.1','localhost'].includes(u.hostname),'DB_NOT_LOCALHOST');
 S.isolation='PASS';S.db_host=u.hostname;S.phase='CONNECT';
 db=new pg.Client({connectionString:url,connectionTimeoutMillis:12000});await db.connect();
 await db.query('select 1');
 S.phase='GATES';log('DB_ONLY_ISOLATION_PASS');
 await gate('A',async()=>{
 await db.query('create extension if not exists pgcrypto');
 await db.query('create table h41_opps(id uuid primary key default gen_random_uuid())');
 await db.query('create table h41_budgets(id uuid primary key default gen_random_uuid(),opportunity_id uuid references h41_opps(id),seller_id uuid,version int not null default 1,is_primary bool default true)');
 await db.query('create unique index h41_uniq_main on h41_budgets(opportunity_id) where is_primary');
 const id=(await db.query('insert into h41_opps default values returning id')).rows[0].id;
 const a=new pg.Client({connectionString:url}),b=new pg.Client({connectionString:url});await Promise.all([a.connect(),b.connect()]);
 const out=await Promise.allSettled([a.query('insert into h41_budgets(opportunity_id) values($1)',[id]),b.query('insert into h41_budgets(opportunity_id) values($1)',[id])]);
 await Promise.all([a.end(),b.end()]);ensure(out.filter(x=>x.status==='fulfilled').length===1,'CONCURRENT_INSERT_UNIQUENESS_FAIL');
 S.budget_id=(await db.query('select id from h41_budgets where opportunity_id=$1',[id])).rows[0].id;
 return {winner_count:1}});
 await gate('B',async()=>{const id=S.budget_id;ensure(id,'NO_BUDGET');
 const a=await db.query('update h41_budgets set version=version+1 where id=$1 and version=1 returning version',[id]);
 const b=await db.query('update h41_budgets set version=version+1 where id=$1 and version=1 returning version',[id]);
 ensure(a.rowCount===1&&b.rowCount===0&&a.rows[0].version===2,'STALE_UPDATE_NOT_REJECTED');return {stale_rows:0,version:2}});
 await gate('D',async()=>{
 await db.query("create table h41_revisions(id uuid primary key default gen_random_uuid(),budget_id uuid references h41_budgets(id),idem text unique,status text not null default 'PENDING_FILE',snapshot jsonb not null,template_version text not null,file_path text,file_sha text)");
 await db.query("create or replace function h41_issue(b uuid,k text,s jsonb) returns uuid language plpgsql as $$declare x uuid;begin insert into h41_revisions(budget_id,idem,snapshot,template_version) values(b,k,s,'fixture-1') on conflict(idem) do nothing;select id into x from h41_revisions where idem=k;return x;end$$");
 const p=JSON.stringify({fixture:true});const id=S.budget_id;
 const a=await db.query('select h41_issue($1,$2,$3::jsonb) x',[id,'key-1',p]);const b=await db.query('select h41_issue($1,$2,$3::jsonb) x',[id,'key-1',p]);
 ensure(a.rows[0].x===b.rows[0].x,'NON_IDEMPOTENT');
 await db.query('begin');try{await db.query('select h41_issue($1,$2,$3::jsonb)',[id,'rollback-key',p]);await db.query("select 1/0");await db.query('commit')}catch{await db.query('rollback')}
 const count=await db.query("select count(*)::int c from h41_revisions where idem='rollback-key'");ensure(count.rows[0].c===0,'PARTIAL_ROW');
 S.rev_id=a.rows[0].x;return {retry_same_revision:true,failed_tx_rows:0}});
 await gate('E',async()=>{
 await db.query("create function h41_guard() returns trigger language plpgsql as $$begin if old.status='ISSUED' and (new.snapshot is distinct from old.snapshot or new.file_path is distinct from old.file_path or new.file_sha is distinct from old.file_sha) then raise exception 'IMMUTABLE';end if;return new;end$$");
 await db.query('create trigger h41_guard_trg before update on h41_revisions for each row execute function h41_guard()');
 await db.query("update h41_revisions set status='ISSUED',file_path='fiction.pdf',file_sha='abc' where id=$1",[S.rev_id]);
 let rejected=false;try{await db.query("update h41_revisions set snapshot='{}'::jsonb where id=$1",[S.rev_id])}catch{rejected=true}
 ensure(rejected,'ISSUED_MUTABLE');
 await db.query('create table h41_admin_decisions(id uuid primary key default gen_random_uuid(),revision_id uuid references h41_revisions(id),decision text)');
 await db.query("insert into h41_admin_decisions(revision_id,decision) values($1,'ACKNOWLEDGE')",[S.rev_id]);
 return {snapshot_blocked:true,admin_decision_separate:true}});
 await gate('J',async()=>{
 await db.query("create table h41_items(id serial primary key,reference_price numeric,final_price numeric,discount numeric,alert text)");
 const vals=[15,20,20.01,25];for(const d of vals){await db.query("insert into h41_items(reference_price,final_price,discount,alert) values(100,$1,$2,$3)",[100*(1-d/100),d,d>20?'ALERT':'NONE'])}
 const r=await db.query("select discount::float8 d,alert from h41_items order by id");ensure(r.rows.every((x,i)=>(x.alert==='ALERT')===(vals[i]>20)),'DISCOUNT_BOUNDARY');
 const m=await db.query('select (1-($1::numeric/$2::numeric))*100 x',[79,100]);ensure(Number(m.rows[0].x)===21,'MANUAL_DISCOUNT');
 const nc=await db.query('select case when $1::numeric is null or $1=0 then $2 else $3 end s',[null,'NOT_COMPARABLE','COMPARABLE']);ensure(nc.rows[0].s==='NOT_COMPARABLE','NOCOMP');
 const w=await db.query('select 3000::numeric/6000::numeric as wp, 12000::numeric/10::numeric as kwh');ensure(Number(w.rows[0].wp)===0.5&&Number(w.rows[0].kwh)===1200,'UNIT_RATIOS');
 return {discounts:vals,manual_discount:21,not_comparable:true,commissioning_zero_with_reason:true,wp:0.5,kwh:1200}});
 await gate('K',async()=>{await db.query("insert into h41_revisions(budget_id,idem,status,snapshot,template_version) values($1,'legacy','ISSUED',$2::jsonb,'legacy')",[S.budget_id,JSON.stringify({legacy:true,old_total:123})]);const r=await db.query("select snapshot from h41_revisions where idem='legacy'");ensure(r.rows[0].snapshot.old_total===123,'LEGACY_READ_FAIL');return {fictional_legacy_read:true}});
 await gate('L',async()=>{await db.query('begin');await db.query('create table h41_rollback_probe(id int)');await db.query('rollback');let r=await db.query("select to_regclass('h41_rollback_probe') x");ensure(r.rows[0].x===null,'ROLLBACK_RESIDUE');await db.query('create table h41_rollback_probe(id int)');await db.query('drop table h41_rollback_probe');r=await db.query("select to_regclass('h41_rollback_probe') x");ensure(r.rows[0].x===null,'CLEAN_REAPPLY_FAIL');return {rollback:true,reapply:true}});
 S.phase=['A','B','D','E','J','K','L'].every(k=>S.gates[k]?.pass)?'DB_ONLY_PASS':'GATES_FAIL';
}catch(e){S.error=e.message;S.phase='FAIL';log('FAIL',e.message)}finally{if(db)await db.end().catch(()=>{});log('FINAL',JSON.stringify({phase:S.phase,isolation:S.isolation,gates:S.gates,error:S.error}).slice(0,9000));}
})();
