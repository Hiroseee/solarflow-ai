import {execFile} from 'node:child_process';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {createClient} from '@supabase/supabase-js';
const SQL="-- TEST FIXTURE ONLY. H5-B disposable Postgres/Auth/REST. NOT CANONICAL MIGRATION.\ncreate extension if not exists pgcrypto;\ncreate table public.h5b_drafts(id text primary key,owner_id uuid not null,version bigint not null default 1, data jsonb not null default '{}'::jsonb);\ncreate table public.h5b_receipts(draft_id text not null,mutation_id text not null, owner_id uuid not null,result jsonb not null, primary key(draft_id,mutation_id));\nalter table public.h5b_drafts enable row level security;\nalter table public.h5b_receipts enable row level security;\ncreate policy h5b_own_read on public.h5b_drafts for select to authenticated using(owner_id=(select auth.uid()));\ncreate policy h5b_own_insert on public.h5b_drafts for insert to authenticated with check(owner_id=(select auth.uid()));\ncreate policy h5b_own_update on public.h5b_drafts for update to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));\ngrant select,insert,update on public.h5b_drafts to authenticated;\n-- Strictly scoped SECURITY DEFINER only for atomic receipt+update; explicit uid check and empty search_path.\ncreate function public.h5b_create_draft(p_id text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $h5b$\ndeclare r public.h5b_drafts;\nbegin\n if auth.uid() is null then raise exception 'UNAUTHORIZED' using errcode='42501'; end if;\n insert into public.h5b_drafts(id,owner_id,data) values(p_id,auth.uid(),p_data) returning * into r;\n return jsonb_build_object('id',r.id,'version',r.version,'data',r.data);\nend $h5b$;\ncreate function public.h5b_load_draft(p_id text) returns jsonb language sql stable security invoker set search_path='' as $h5b$\n select jsonb_build_object('id',d.id,'version',d.version,'data',d.data)\n from public.h5b_drafts d where d.id=p_id and d.owner_id=(select auth.uid())\n$h5b$;\ncreate function public.h5b_save_draft(p_id text,p_expected bigint,p_data jsonb,p_mutation text) returns jsonb language plpgsql security definer set search_path='' as $h5b$\ndeclare existing public.h5b_receipts; current_row public.h5b_drafts; result jsonb;\nbegin\n if auth.uid() is null or p_mutation is null or length(p_mutation)<1 then raise exception 'UNAUTHORIZED_OR_EMPTY_MUTATION' using errcode='42501';end if;\n select * into current_row from public.h5b_drafts where id=p_id for update;\n if not found or current_row.owner_id<>auth.uid() then raise exception 'NOT_FOUND' using errcode='42501'; end if;\n select * into existing from public.h5b_receipts where draft_id=p_id and mutation_id=p_mutation;\n if found then\n   if existing.owner_id<>auth.uid() then raise exception 'RECEIPT_OWNER_MISMATCH' using errcode='42501';end if;\n   return jsonb_build_object('status','saved','row',existing.result);\n end if;\n if current_row.version<>p_expected then\n   return jsonb_build_object('status','conflict','current',jsonb_build_object('id',current_row.id,'version',current_row.version,'data',current_row.data));\n end if;\n update public.h5b_drafts set data=p_data, version=version+1 where id=p_id returning * into current_row;\n result=jsonb_build_object('id',current_row.id,'version',current_row.version,'data',current_row.data);\n insert into public.h5b_receipts(draft_id,mutation_id,owner_id,result) values(p_id,p_mutation,auth.uid(),result);\n return jsonb_build_object('status','saved','row',result);\nend $h5b$;\nrevoke all on function public.h5b_create_draft(text,jsonb) from public;\nrevoke all on function public.h5b_load_draft(text) from public;\nrevoke all on function public.h5b_save_draft(text,bigint,jsonb,text) from public;\ngrant execute on function public.h5b_create_draft(text,jsonb),public.h5b_load_draft(text),public.h5b_save_draft(text,bigint,jsonb,text) to authenticated;\n";
const REVISIONS="-- H5-F disposable PostgreSQL fixture ONLY. Never apply to CRM canonical schema.\ncreate table public.h5f_test_revisions (\n budget_id text not null, revision_no integer not null check (revision_no>0),\n owner_id uuid not null, mutation_id text not null, draft_version bigint not null,\n snapshot jsonb not null, snapshot_sha256 text not null, pdf_sha256 text not null,\n object_ref text not null, state text not null default 'FIXTURE_PENDING_FILE'\n check(state in ('FIXTURE_PENDING_FILE','FIXTURE_AVAILABLE')),\n primary key(budget_id,revision_no),unique(budget_id,mutation_id)\n);\nalter table public.h5f_test_revisions enable row level security;\ncreate policy h5f_read_owner on public.h5f_test_revisions for select to authenticated using(owner_id=(select auth.uid()));\ngrant select on public.h5f_test_revisions to authenticated;\ncreate function public.h5f_test_record(p_budget text,p_revision integer,p_version bigint,p_mutation text,p_snapshot jsonb,p_snapshot_hash text,p_pdf_hash text,p_object text)\nreturns jsonb language plpgsql security definer set search_path='' as $body$\ndeclare d public.h5b_drafts; existing public.h5f_test_revisions; row_new public.h5f_test_revisions;\nbegin\n if auth.uid() is null or p_mutation is null or p_mutation='' or p_revision<1 or p_object='' then raise exception 'INVALID_INPUT' using errcode='42501';end if;\n select * into d from public.h5b_drafts where id=p_budget for update;\n if not found or d.owner_id<>auth.uid() then raise exception 'BUDGET_ACCESS_DENIED' using errcode='42501';end if;\n select * into existing from public.h5f_test_revisions where budget_id=p_budget and mutation_id=p_mutation;\n if found then\n   if existing.revision_no<>p_revision or existing.snapshot_sha256<>p_snapshot_hash or existing.pdf_sha256<>p_pdf_hash then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';end if;\n   return jsonb_build_object('result','idempotent','revision',existing.revision_no,'state',existing.state);\n end if;\n if d.version<>p_version then raise exception 'STALE_DRAFT_VERSION' using errcode='40001';end if;\n if coalesce(length(p_snapshot_hash),0)<>64 or coalesce(length(p_pdf_hash),0)<>64 then raise exception 'INVALID_HASH';end if;\n insert into public.h5f_test_revisions(budget_id,revision_no,owner_id,mutation_id,draft_version,snapshot,snapshot_sha256,pdf_sha256,object_ref)\n values(p_budget,p_revision,auth.uid(),p_mutation,p_version,p_snapshot,p_snapshot_hash,p_pdf_hash,p_object) returning * into row_new;\n return jsonb_build_object('result','created','revision',row_new.revision_no,'state',row_new.state);\nend $body$;\ncreate function public.h5f_test_confirm(p_budget text,p_revision integer,p_pdf_hash text)\nreturns jsonb language plpgsql security definer set search_path='' as $body$\ndeclare r public.h5f_test_revisions;\nbegin\n if auth.uid() is null then raise exception 'UNAUTHORIZED' using errcode='42501';end if;\n select * into r from public.h5f_test_revisions where budget_id=p_budget and revision_no=p_revision for update;\n if not found or r.owner_id<>auth.uid() then raise exception 'REVISION_ACCESS_DENIED' using errcode='42501';end if;\n if r.pdf_sha256<>p_pdf_hash then raise exception 'PDF_HASH_MISMATCH';end if;\n update public.h5f_test_revisions set state='FIXTURE_AVAILABLE' where budget_id=p_budget and revision_no=p_revision;\n return jsonb_build_object('result','confirmed','state','FIXTURE_AVAILABLE');\nend $body$;\nrevoke all on function public.h5f_test_record(text,integer,bigint,text,jsonb,text,text,text) from public;\nrevoke all on function public.h5f_test_confirm(text,integer,text) from public;\ngrant execute on function public.h5f_test_record(text,integer,bigint,text,jsonb,text,text,text),public.h5f_test_confirm(text,integer,text) to authenticated;\ncreate function public.h5f_test_guard_immutable() returns trigger language plpgsql set search_path='' as $body$\nbegin\n if old.budget_id<>new.budget_id or old.revision_no<>new.revision_no or old.owner_id<>new.owner_id or old.mutation_id<>new.mutation_id\n or old.draft_version<>new.draft_version or old.snapshot<>new.snapshot or old.snapshot_sha256<>new.snapshot_sha256\n or old.pdf_sha256<>new.pdf_sha256 or old.object_ref<>new.object_ref then raise exception 'FROZEN_REVISION_IMMUTABLE';end if;\n return new;\nend $body$;\ncreate trigger h5f_test_immutable before update on public.h5f_test_revisions for each row execute function public.h5f_test_guard_immutable();\n";
const state={phase:'STARTING',isolation:false,passes:[],error:null};
const log=(...a)=>console.log('[H5G_PG]',...a);
const pass=k=>{state.passes.push(k);log('PASS',k)};
const check=(condition,msg)=>{if(!condition)throw Error(msg)};
createServer((_q,r)=>{r.setHeader('content-type','application/json');r.end(JSON.stringify(state))}).listen(Number(process.env.PORT||10000),'0.0.0.0');
function run(args,ms=160000){return new Promise((resolve,reject)=>execFile('npx',['--no-install','supabase',...args],{env:{...process.env,SUPABASE_EXPERIMENTAL_STACK:'1'},timeout:ms,maxBuffer:4e6},(e,out,err)=>{log(args[0],e?'FAIL':'PASS');e?reject(Error(e.message+' '+(err||'').slice(-400))):resolve(out)}))}
let db;
(async()=>{try{
 check(!Object.keys(process.env).some(k=>/SUPABASE_(ACCESS_TOKEN|DB_PASSWORD|SERVICE_ROLE_KEY)|BESS.*(SECRET|TOKEN|PASSWORD)|CRM.*(SECRET|TOKEN|PASSWORD)/i.test(k)),'UNSAFE_HOST_SECRETS');
 await run(['init','--force'],45000);
 await run(['start','--runtime','native','--preparation','on-demand','--exclude','realtime,storage,functions,studio,mail,analytics,pooler'],160000);
 const raw=await run(['status','--output-format','json'],45000),j=JSON.parse(raw.slice(raw.indexOf('{'),raw.lastIndexOf('}')+1));
 const dbUrl=j.env?.DB_URL||j.endpoints?.database?.sql?.url,api=j.env?.API_URL||j.endpoints?.api?.url||j.endpoints?.rest?.url;
 check(j.runtime==='native'&&dbUrl&&api&&['localhost','127.0.0.1'].includes(new URL(dbUrl).hostname)&&['localhost','127.0.0.1'].includes(new URL(api).hostname),'NOT_NATIVE_LOOPBACK');
 const anon=j.env?.ANON_KEY||j.env?.PUBLISHABLE_KEY,service=j.env?.SERVICE_ROLE_KEY||j.env?.SECRET_KEY;
 check(anon&&service,'NO_LOCAL_JWT_KEYS');
 db=new pg.Client({connectionString:dbUrl});await db.connect();state.isolation=true;pass('native_local_isolation');
 await db.query(SQL);await db.query(REVISIONS);await db.query("-- H5-G: DISPOSABLE test fixture only, applied after H5-B and H5-F.\n-- DENY BY DEFAULT: neither a new commercial role nor an approved price/discount rule.\n-- Never apply this fixture to a canonical schema.\nrevoke insert,update,delete on public.h5b_drafts from authenticated;\nrevoke execute on function public.h5b_create_draft(text,jsonb) from authenticated;\nrevoke execute on function public.h5b_save_draft(text,bigint,jsonb,text) from authenticated;\n\ncreate policy h5g_owner_restrict_select on public.h5b_drafts as restrictive\n for select to authenticated using (owner_id=(select auth.uid()));\ncreate policy h5g_owner_restrict_insert on public.h5b_drafts as restrictive\n for insert to authenticated with check (owner_id=(select auth.uid()));\ncreate policy h5g_owner_restrict_update on public.h5b_drafts as restrictive\n for update to authenticated using (owner_id=(select auth.uid()))\n with check (owner_id=(select auth.uid()));\n\n-- Shape only: canonical product eligibility and role permissions are NOT inferred.\n-- Every writable root and nested line property is enumerated; unknown fields are denied.\ncreate function public.h5g_validate_payload(p_data jsonb)\nreturns void language plpgsql security invoker set search_path='' as $h5g$\ndeclare line jsonb; seen text[]:=array[]::text[]; line_id text; linked text;\nbegin\n if pg_catalog.jsonb_typeof(p_data) is distinct from 'object'\n or exists (\n  select 1 from pg_catalog.jsonb_object_keys(p_data) as k(name)\n  where name <> all (array['client','kitChoice','items','pricing',\n                            'opportunityId','proposalId','approvedCommercialTerms']::text[])\n ) then raise exception 'INVALID_ROOT_FIELDS' using errcode='42501'; end if;\n if p_data ? 'client' and (\n   pg_catalog.jsonb_typeof(p_data->'client') not in ('string','null')\n   or length(p_data->>'client')>256\n ) then raise exception 'INVALID_CLIENT' using errcode='42501';end if;\n if p_data ? 'kitChoice' and (\n  pg_catalog.jsonb_typeof(p_data->'kitChoice') not in ('string','null')\n  or (pg_catalog.jsonb_typeof(p_data->'kitChoice')='string'\n      and p_data->>'kitChoice' not in ('12kw','15kw'))\n ) then raise exception 'INVALID_KIT' using errcode='42501';end if;\n if p_data ? 'items' then\n  if pg_catalog.jsonb_typeof(p_data->'items') <> 'array' then\n   raise exception 'INVALID_ITEMS' using errcode='42501';end if;\n  if pg_catalog.jsonb_array_length(p_data->'items')>300 then\n   raise exception 'TOO_MANY_ITEMS' using errcode='42501';end if;\n  for line in select value from pg_catalog.jsonb_array_elements(p_data->'items') as t(value) loop\n   if pg_catalog.jsonb_typeof(line) <> 'object'\n   or exists (\n    select 1 from pg_catalog.jsonb_object_keys(line) as k(name)\n    where name <> all (array['lineId','productId','category','quantity',\n                             'kitChoice','relatedBessLineId']::text[])\n   ) then raise exception 'INVALID_LINE_FIELDS' using errcode='42501'; end if;\n   line_id:=line->>'lineId';\n   if pg_catalog.jsonb_typeof(line->'lineId')<>'string'\n   or line_id is null or length(pg_catalog.btrim(line_id)) not between 1 and 128\n   or line_id=any(seen) then\n     raise exception 'INVALID_OR_DUPLICATE_LINE_ID' using errcode='42501';end if;\n   seen:=pg_catalog.array_append(seen,line_id);\n   if pg_catalog.jsonb_typeof(line->'productId') is distinct from 'string'\n   or length(pg_catalog.btrim(line->>'productId')) not between 1 and 128 then\n     raise exception 'INVALID_PRODUCT_ID' using errcode='42501';end if;\n   if pg_catalog.jsonb_typeof(line->'quantity') is distinct from 'number'\n   or length(line->>'quantity')>6\n   or (line->>'quantity') !~ '^[1-9][0-9]*$'\n   or (line->>'quantity')::integer>100000 then\n     raise exception 'INVALID_QUANTITY' using errcode='42501';end if;\n   if line ? 'category' and (\n     pg_catalog.jsonb_typeof(line->'category')<>'string'\n     or line->>'category' not in ('inverter','bess','module','structure',\n      'dc_cable_black','dc_cable_red','mc4','accessory','other')\n   ) then raise exception 'INVALID_CATEGORY' using errcode='42501';end if;\n   if line ? 'kitChoice' and pg_catalog.jsonb_typeof(line->'kitChoice')<>'null'\n    and (pg_catalog.jsonb_typeof(line->'kitChoice')<>'string'\n         or line->>'kitChoice' not in ('12kw','15kw')) then\n     raise exception 'INVALID_LINE_KIT' using errcode='42501';end if;\n   if line ? 'relatedBessLineId'\n    and pg_catalog.jsonb_typeof(line->'relatedBessLineId') not in ('string','null')\n    then raise exception 'INVALID_ACCESSORY_LINK' using errcode='42501';end if;\n  end loop;\n  for line in select value from pg_catalog.jsonb_array_elements(p_data->'items') as t(value) loop\n   linked:=line->>'relatedBessLineId';\n   if linked is not null then\n    if line->>'category' is distinct from 'accessory'\n       or length(pg_catalog.btrim(linked)) not between 1 and 128\n       or not exists (\n        select 1 from pg_catalog.jsonb_array_elements(p_data->'items') as t(value)\n        where value->>'lineId'=linked and value->>'category'='bess'\n       ) then raise exception 'ORPHAN_OR_INVALID_ACCESSORY' using errcode='42501';end if;\n   end if;\n  end loop;\n end if;\nend $h5g$;\n\n-- New initial-draft entrypoint: legacy unrestricted create is revoked.\ncreate function public.h5g_safe_create(p_budget text,p_data jsonb)\nreturns jsonb language plpgsql security definer set search_path='' as $h5g$\ndeclare r public.h5b_drafts;\nbegin\n if (select auth.uid()) is null or p_budget is null\n  or length(pg_catalog.btrim(p_budget)) not between 1 and 128 then\n  raise exception 'ACCESS_DENIED' using errcode='42501';end if;\n perform public.h5g_validate_payload(p_data);\n if p_data ?| array['pricing','opportunityId','proposalId','approvedCommercialTerms'] then\n  raise exception 'PENDING_APPROVED_CREATE_FIELDS' using errcode='42501';end if;\n insert into public.h5b_drafts(id,owner_id,data)\n values(p_budget,(select auth.uid()),p_data) returning * into r;\n return pg_catalog.jsonb_build_object('id',r.id,'version',r.version,'data',r.data);\nend $h5g$;\n\ncreate function public.h5g_safe_edit(p_budget text,p_version bigint,p_data jsonb,p_mutation text)\nreturns jsonb language plpgsql security definer set search_path='' as $h5g$\ndeclare r public.h5b_drafts; prev public.h5b_receipts; output jsonb;\nbegin\n if (select auth.uid()) is null or p_mutation is null\n or length(pg_catalog.btrim(p_mutation)) not between 1 and 128 then\n  raise exception 'ACCESS_DENIED' using errcode='42501';end if;\n -- Authenticate and check owner before returning a receipt or any version detail.\n select * into r from public.h5b_drafts where id=p_budget for update;\n if not found or r.owner_id<>(select auth.uid()) then\n  raise exception 'ACCESS_DENIED' using errcode='42501';end if;\n perform public.h5g_validate_payload(p_data);\n select * into prev from public.h5b_receipts\n where draft_id=p_budget and mutation_id=p_mutation;\n if found then\n  if prev.owner_id<>(select auth.uid())\n  or prev.result->'data' is distinct from p_data\n  or (prev.result->>'version')::bigint is distinct from (p_version+1) then\n   raise exception 'IDEMPOTENCY_PAYLOAD_CONFLICT' using errcode='42501';end if;\n  return pg_catalog.jsonb_build_object('status','saved','row',prev.result);\n end if;\n if r.version<>p_version then\n  return pg_catalog.jsonb_build_object('status','conflict');end if;\n -- Server-controlled links/approval, and all financial amounts, are immutable\n -- until the canonical policy matrix and H5-A reconciliation are approved.\n if p_data->'pricing' is distinct from r.data->'pricing'\n or p_data->'approvedCommercialTerms' is distinct from r.data->'approvedCommercialTerms'\n or p_data->'opportunityId' is distinct from r.data->'opportunityId'\n or p_data->'proposalId' is distinct from r.data->'proposalId' then\n  raise exception 'PENDING_APPROVED_PERMISSION' using errcode='42501';end if;\n update public.h5b_drafts set data=p_data,version=version+1\n where id=p_budget returning * into r;\n output:=pg_catalog.jsonb_build_object('id',r.id,'version',r.version,'data',r.data);\n insert into public.h5b_receipts(draft_id,mutation_id,owner_id,result)\n values(p_budget,p_mutation,(select auth.uid()),output);\n return pg_catalog.jsonb_build_object('status','saved','row',output);\nend $h5g$;\n\nrevoke all on function public.h5g_validate_payload(jsonb) from public;\nrevoke all on function public.h5g_safe_create(text,jsonb) from public;\nrevoke all on function public.h5g_safe_edit(text,bigint,jsonb,text) from public;\ngrant execute on function public.h5g_safe_create(text,jsonb),\n public.h5g_safe_edit(text,bigint,jsonb,text) to authenticated;\n");pass('h5g_security_sql_fixture');
 const admin=createClient(api,service,{auth:{persistSession:false,autoRefreshToken:false}}),clients=[];
 for(let i=0;i<2;i++){const email='h5f-'+i+'-'+Date.now()+'@example.test',password='FixtureLocalOnly!234';const u=await admin.auth.admin.createUser({email,password,email_confirm:true});check(!u.error,'LOCAL_USER_CREATE');const c=createClient(api,anon,{auth:{persistSession:false,autoRefreshToken:false}});const auth=await c.auth.signInWithPassword({email,password});check(!auth.error,'LOCAL_JWT_LOGIN');clients.push(c)}
 pass('two_real_user_jwts');
 const [seller,other]=clients,budget='h5f-budget-'+Date.now();
 const oldCreate=await seller.rpc('h5b_create_draft',{p_id:'forbidden-old',p_data:{client:'invalid'}});
 check(!!oldCreate.error,'LEGACY_CREATE_RPC_NOT_REVOKED');pass('legacy_create_rpc_revoked');
 const forbiddenInsert=await seller.from('h5b_drafts').insert({id:'direct-create',owner_id:(await seller.auth.getUser()).data.user.id,data:{client:'direct'}});
 check(!!forbiddenInsert.error,'DIRECT_INSERT_NOT_REVOKED');pass('direct_insert_permission_revoked');
 const unsafeCreate=await seller.rpc('h5g_safe_create',{p_budget:'unsafe-create',p_data:{client:'bad',pricing:{unitPrices:{x:1}}}});
 check(!!unsafeCreate.error,'UNAPPROVED_PRICE_AT_CREATE');pass('create_pricing_denied');
 const badCreate=await seller.rpc('h5g_safe_create',{p_budget:'missing-quantity',p_data:{client:'bad',items:[{lineId:'a',productId:'p'}]}});
 check(!!badCreate.error,'MISSING_QUANTITY_ACCEPTED');pass('create_missing_quantity_denied');
 const anonClientPre=createClient(api,anon,{auth:{persistSession:false,autoRefreshToken:false}});
 const anonNew=await anonClientPre.rpc('h5g_safe_create',{p_budget:'anon-budget',p_data:{client:'anon'}});
 check(!!anonNew.error,'ANON_CREATE_ACCEPTED');pass('anonymous_create_denied');
 const create=await seller.rpc('h5g_safe_create',{p_budget:budget,p_data:{client:'Somente fixture'}});
 check(!create.error&&create.data.version===1,'DRAFT_CREATE_FAILED');pass('fixture_budget_created');
 const hash=x=>createHash('sha256').update(x).digest('hex');
 const snapshot={mode:'PREVIEW_PDF_FIXTURE',budgetId:budget,revisionId:'rev-001',draftVersion:1,client:'FICTITIOUS'};
 const args={p_budget:budget,p_revision:1,p_version:1,p_mutation:'req-001',p_snapshot:snapshot,p_snapshot_hash:hash(JSON.stringify(snapshot)),p_pdf_hash:hash('%PDF-FICTITIOUS'),p_object:'private-test/'+budget+'/r1.pdf'};
 const record=await seller.rpc('h5f_test_record',args);
 check(!record.error&&record.data.result==='created'&&record.data.state==='FIXTURE_PENDING_FILE','RECORD_FAILED:'+record.error?.message);pass('snapshot_revision_pg_pending_state');
 const idempotent=await seller.rpc('h5f_test_record',args);
 check(!idempotent.error&&idempotent.data.result==='idempotent','RETRY_CREATED_DUPLICATE');pass('mutation_idempotency_real_pg');
 const unauthorized=await other.rpc('h5f_test_record',{...args,p_mutation:'other-request'});
 check(!!unauthorized.error,'CROSS_OWNER_WRITE_ALLOWED');
 const crossRead=await other.from('h5f_test_revisions').select('*').eq('budget_id',budget);
 check(!crossRead.error&&crossRead.data.length===0,'CROSS_OWNER_READ_ALLOWED');pass('jwt_cross_owner_denied');
 const stale=await seller.rpc('h5f_test_record',{...args,p_mutation:'stale',p_revision:2,p_version:99});
 check(!!stale.error&&/STALE_DRAFT_VERSION/.test(stale.error.message),'STALE_VERSION_ACCEPTED');pass('stale_draft_rejected');
 const invalid=await seller.rpc('h5f_test_confirm',{p_budget:budget,p_revision:1,p_pdf_hash:hash('tampered')});
 check(!!invalid.error,'BAD_PDF_HASH_ACCEPTED');pass('mismatched_pdf_hash_rejected');
 const confirm=await seller.rpc('h5f_test_confirm',{p_budget:budget,p_revision:1,p_pdf_hash:args.p_pdf_hash});
 check(!confirm.error&&confirm.data.state==='FIXTURE_AVAILABLE','CONFIRM_FAILED:'+confirm.error?.message);pass('fixture_confirmation_state');
 const current=await seller.from('h5f_test_revisions').select('*').eq('budget_id',budget).order('revision_no');
 check(!current.error&&current.data.length===1&&current.data[0].snapshot.client==='FICTITIOUS','REVISION_READ_FAILED');
 const mutation=await seller.from('h5f_test_revisions').update({snapshot:{client:'ALTERED'}}).eq('budget_id',budget).eq('revision_no',1).select();
 check(!!mutation.error||mutation.data.length===0,'FROZEN_REVISION_MODIFIED');pass('frozen_snapshot_update_denied');
 const mutationId='race-'+Date.now();
 const race=await Promise.all([seller.rpc('h5f_test_record',{...args,p_revision:2,p_mutation:mutationId,p_object:'private-test/'+budget+'/r2.pdf'}),seller.rpc('h5f_test_record',{...args,p_revision:2,p_mutation:'other-race',p_object:'private-test/'+budget+'/r2.pdf'})]);
 check(race.filter(x=>!x.error&&x.data.result==='created').length===1&&race.filter(x=>!!x.error).length===1,'REVISION_RACE_UNIQUE_FAILED');
 pass('two_independent_rpc_race_unique');
 const second=await seller.from('h5f_test_revisions').select('*').eq('budget_id',budget).order('revision_no');
 check(!second.error&&second.data.length===2&&second.data[0].state==='FIXTURE_AVAILABLE'&&second.data[1].state==='FIXTURE_PENDING_FILE','HISTORY_INCONSISTENT');pass('previous_revision_preserved_and_pending_not_issued');
 
 const sellerIdentity=await seller.auth.getUser(),owner=sellerIdentity.data.user.id;
 const original=await seller.from('h5b_drafts').select('id,owner_id,version,data').eq('id',budget);
 check(!original.error&&original.data.length===1&&original.data[0].owner_id===owner,'OWNER_READ_FAIL');pass('owner_reads_budget');
 const foreign=await other.from('h5b_drafts').select('id').eq('id',budget);
 check(!foreign.error&&foreign.data.length===0,'FOREIGN_READ_ALLOWED');pass('foreign_cannot_read_budget');
 const anonClient=createClient(api,anon,{auth:{persistSession:false,autoRefreshToken:false}});
 const anonymous=await anonClient.from('h5b_drafts').select('id').eq('id',budget);
 check(!!anonymous.error||anonymous.data.length===0,'ANON_READ_ALLOWED');pass('anonymous_denied');
 const forbiddenDirect=await seller.from('h5b_drafts').update({data:{client:'direct'}}).eq('id',budget).select();
 check(!!forbiddenDirect.error||forbiddenDirect.data.length===0,'DIRECT_UPDATE_ALLOWED');pass('direct_rest_update_denied');
 const oldRpc=await seller.rpc('h5b_save_draft',{p_id:budget,p_expected:1,p_data:{client:'rpc-bypass'},p_mutation:'old'});
 check(!!oldRpc.error,'OLD_RPC_BYPASS_ALLOWED');pass('old_rpc_permission_revoked');
 const forged=await seller.rpc('h5g_safe_edit',{p_budget:budget,p_version:1,p_data:{client:'x',owner_id:'foreign'},p_mutation:'forged'});
 check(!!forged.error,'FORGED_OWNER_ACCEPTED');pass('forged_owner_payload_denied');
 const rogue=await other.rpc('h5g_safe_edit',{p_budget:budget,p_version:1,p_data:{client:'foreign'},p_mutation:'rogue'});
 check(!!rogue.error&&!(rogue.error.message||'').includes('Somente fixture'),'FOREIGN_MUTATION_ALLOWED_OR_LEAKED');pass('cross_owner_safe_rpc_denied');
 const financial=await seller.rpc('h5g_safe_edit',{p_budget:budget,p_version:1,p_data:{client:'new',pricing:{unitPrices:{test:1},discount:{mode:'absolute',cents:999}}},p_mutation:'price'});
 check(!!financial.error,'UNAPPROVED_FINANCE_MUTATION_ALLOWED');pass('financial_edit_denied_pending_approval');
 const badVectors=[
  ['unknown_root',{client:'x',items:[],secretOverride:true}],
  ['forged_total',{client:'x',totalCents:1}],
  ['document_metadata',{client:'x',storagePath:'private/other.pdf'}],
  ['bad_quantity_string',{client:'x',items:[{lineId:'l',productId:'p',quantity:'2'}]}],
  ['bad_quantity_zero',{client:'x',items:[{lineId:'l',productId:'p',quantity:0}]}],
  ['nested_price',{client:'x',items:[{lineId:'l',productId:'p',quantity:1,unitCents:100}]}],
  ['duplicate_line',{client:'x',items:[{lineId:'d',productId:'p',quantity:1},{lineId:'d',productId:'p',quantity:1}]}],
  ['invalid_kit',{client:'x',kitChoice:'99kw'}],
  ['orphan_accessory',{client:'x',items:[{lineId:'a',productId:'p',category:'accessory',quantity:1,relatedBessLineId:'missing'}]}],
  ['approved_terms',{client:'x',approvedCommercialTerms:'forged'}],
  ['proposal_link',{client:'x',proposalId:'foreign-proposal'}]
 ];
 for(const [label,payload] of badVectors){
   const denied=await seller.rpc('h5g_safe_edit',{p_budget:budget,p_version:1,p_data:payload,p_mutation:'invalid-'+label});
   check(!!denied.error,'TAMPERED_PAYLOAD_ACCEPTED:'+label);
   pass('deny_'+label);
 }
 const eligible=await seller.rpc('h5g_safe_edit',{p_budget:budget,p_version:1,p_data:{client:'Edited',items:[{lineId:'fictional',productId:'fixture',quantity:2}]},p_mutation:'accepted'});
 check(!eligible.error&&eligible.data.status==='saved'&&eligible.data.row.version===2,'SAFE_EDIT_FAILURE:'+eligible.error?.message);pass('owner_safe_edit_pass');
 const repeated=await seller.rpc('h5g_safe_edit',{p_budget:budget,p_version:1,p_data:{client:'Edited',items:[{lineId:'fictional',productId:'fixture',quantity:2}]},p_mutation:'accepted'});
 check(!repeated.error&&repeated.data.row.version===2,'DUPLICATE_CHANGED_VERSION');pass('safe_edit_idempotent_retry');
 const idempotencyTamper=await seller.rpc('h5g_safe_edit',{p_budget:budget,p_version:1,p_data:{client:'CHANGED',items:[{lineId:'fictional',productId:'fixture',quantity:2}]},p_mutation:'accepted'});
 check(!!idempotencyTamper.error,'IDEMPOTENCY_MUTATION_COLLISION_ACCEPTED');pass('idempotency_payload_collision_denied');
 const linked=await seller.rpc('h5g_safe_edit',{p_budget:budget,p_version:2,p_data:{client:'Edited',kitChoice:'12kw',items:[
  {lineId:'bess-line',productId:'fictitious-bess',category:'bess',quantity:1},
  {lineId:'acc-line',productId:'fictitious-accessory',category:'accessory',quantity:2,relatedBessLineId:'bess-line'}
 ]},p_mutation:'valid-linked'});
 check(!linked.error&&linked.data.status==='saved'&&linked.data.row.version===3,'VALID_ASSOCIATION_REJECTED:'+linked.error?.message);pass('valid_accessory_bess_shape_owner_pass');

 const staleEdit=await seller.rpc('h5g_safe_edit',{p_budget:budget,p_version:1,p_data:{client:'stale'},p_mutation:'stale-new'});
 check(!staleEdit.error&&staleEdit.data.status==='conflict','STALE_WRITER_NOT_REJECTED');pass('version_conflict_denied');
 const history=await other.from('h5f_test_revisions').select('budget_id,revision_no,object_ref').eq('budget_id',budget);
 check(!history.error&&history.data.length===0,'REVISION_METADATA_LEAK');pass('revision_metadata_owner_only');
 const bypass=await other.rpc('h5f_test_confirm',{p_budget:budget,p_revision:1,p_pdf_hash:args.p_pdf_hash});
 check(!!bypass.error,'OTHER_SELLER_CONFIRMED_REVISION');pass('revision_confirmation_denied');
 const policies=await db.query("select policyname,permissive from pg_policies where schemaname='public' and tablename='h5b_drafts'");
 check(policies.rows.filter(x=>x.permissive==='RESTRICTIVE').length>=3,'NO_RESTRICTIVE_POLICIES');pass('restrictive_rls_composition_verified');


 // H5-H: one sequential, JWT-owned disposable PG draft -> local-only financial preview/PDF
 // -> test-only PG revision METADATA. No private Storage object, canonical pricing or issuance.
 const {H5GIsolatedPostgrestDraftAdapter}=await import('./h5h_crm_fixture/src/h5-h/h5g-safe-postgrest-adapter.mjs');
 const {fictionalCatalog}=await import('./h5h_crm_fixture/src/h5-h/fictional-catalog.mjs');
 const {chooseKit,addItem}=await import('./h5h_crm_fixture/src/h5-c/commercial-items.mjs');
 const {calculateDraft}=await import('./h5h_crm_fixture/src/h5-d/pricing-engine.mjs');
 const {composeProposal}=await import('./h5h_crm_fixture/src/h5-e/proposal-preview.mjs');
 const {snapshotFixture,blockOfficialIssuance}=await import('./h5h_crm_fixture/src/h5-f/fixture-snapshot.mjs');
 const {renderFixturePdf}=await import('./h5h_crm_fixture/src/h5-f/fixture-pdfkit.mjs');
 const h5hBudget='h5h-budget-'+Date.now(),safeAdapter=new H5GIsolatedPostgrestDraftAdapter(seller);
 const h5hCreated=await safeAdapter.create(h5hBudget,{client:'Cliente fictício H5-H',kitChoice:null,items:[]});
 check(h5hCreated.version===1&&h5hCreated.id===h5hBudget,'H5H_SAFE_CREATE_FAILED');pass('h5h_safe_create_real_owner_jwt');
 let safeData=chooseKit(h5hCreated.data,'12kw');
 safeData=addItem(safeData,fictionalCatalog,{productId:'fixture-bess',lineId:'bess-line',quantity:1});
 safeData=addItem(safeData,fictionalCatalog,{productId:'fixture-accessory',lineId:'acc-line',quantity:2,relatedBessLineId:'bess-line'});
 const h5hSaved=await safeAdapter.save({id:h5hBudget,expectedVersion:1,data:safeData,mutationId:'h5h-edit-1'});
 check(h5hSaved.version===2&&h5hSaved.data.items.length===2,'H5H_SAFE_EDIT_FAILED');pass('h5h_safe_edit_bess_accessory_real_pg');
 const h5hReload=await safeAdapter.load(h5hBudget);
 check(h5hReload.version===2&&h5hReload.data.items[1].relatedBessLineId==='bess-line','H5H_REAL_PG_RELOAD_FAILED');
 pass('h5h_reopen_pg_authenticated');
 const noOwner=await other.rpc('h5b_load_draft',{p_id:h5hBudget});
 check(!noOwner.error&&noOwner.data==null,'H5H_CROSS_SELLER_READ');pass('h5h_cross_seller_read_denied');
 let clientPricingRejected=false;
 try{await safeAdapter.save({id:h5hBudget,expectedVersion:2,data:{...safeData,pricing:{unitPrices:{'fixture-bess':700000}}},mutationId:'h5h-danger'})}
 catch(e){clientPricingRejected=/H5G_DENY_BY_DEFAULT/.test(e.message)}
 check(clientPricingRejected,'H5H_ADAPTER_ALLOWED_FINANCE');pass('h5h_finance_adapter_deny_default');
 const serverFinance=await seller.rpc('h5g_safe_edit',{p_budget:h5hBudget,p_version:2,p_data:{...safeData,pricing:{freight:{incoterm:'CIF',mode:'manual',cents:500}}},p_mutation:'h5h-bypass'});
 check(!!serverFinance.error,'H5H_SERVER_ALLOWED_FINANCE');pass('h5h_finance_rpc_deny_default');
 const h5hPrice={unitPrices:{'fixture-bess':700000,'fixture-accessory':2000},freight:{incoterm:'CIF',mode:'manual',cents:9000}};
 const localQuote={...h5hReload.data,pricing:h5hPrice};
 const h5hTotal=calculateDraft(localQuote,fictionalCatalog,h5hPrice);
 check(h5hTotal.totalCents===713000,'H5H_LOCAL_QUOTE_TOTAL_BAD');pass('h5h_quote_calculated_local_not_persisted');
 const h5hPreview=composeProposal(localQuote,fictionalCatalog,{version:2,saveStatus:'saved'});
 check(h5hPreview.financial?.totalCents===713000&&!h5hPreview.validation.readyForIssuance,'H5H_PREVIEW_GATE_BAD');
 pass('h5h_proposal_preview_not_issued');
 const h5hSnapshot=snapshotFixture({budgetId:h5hBudget,revisionId:'r1',revisionLabel:'H5-H Fictícia',
   draft:localQuote,catalog:fictionalCatalog,version:2,eventAt:'2000-01-01T00:00:00.000Z',mutationId:'h5h-pdf-1'});
 const h5hPdf=await renderFixturePdf(h5hSnapshot),h5hPdfHash=createHash('sha256').update(h5hPdf).digest('hex');
 check(h5hPdf.subarray(0,5).toString()==='%PDF-'&&h5hPdfHash.length===64,'H5H_PDFKIT_BYTES_INVALID');pass('h5h_versioned_pdfkit_fixture_bytes');
 const h5hRecord=await seller.rpc('h5f_test_record',{
   p_budget:h5hBudget,p_revision:1,p_version:2,p_mutation:'h5h-pdf-1',p_snapshot:h5hSnapshot,
   p_snapshot_hash:h5hSnapshot.integritySha256,p_pdf_hash:h5hPdfHash,
   p_object:'fixture-only/'+h5hBudget+'/r1.pdf'
 });
 check(!h5hRecord.error&&h5hRecord.data.state==='FIXTURE_PENDING_FILE','H5H_REAL_PG_REVISION_FAILED:'+h5hRecord.error?.message);
 pass('h5h_revision_metadata_real_pg_pending_not_storage');
 const otherHistory=await other.from('h5f_test_revisions').select('budget_id,revision_no').eq('budget_id',h5hBudget);
 check(!otherHistory.error&&otherHistory.data.length===0,'H5H_REVISION_CROSS_OWNER_LEAK');pass('h5h_history_cross_owner_denied');
 const repeat=await safeAdapter.save({id:h5hBudget,expectedVersion:1,data:safeData,mutationId:'h5h-edit-1'});
 check(repeat.version===2,'H5H_IDEMPOTENT_RETRY_FAILED');pass('h5h_auth_rpc_idempotent_retry');
 let h5hStale=false;try{await safeAdapter.save({id:h5hBudget,expectedVersion:1,data:{...safeData,client:'Alterado'},mutationId:'h5h-stale'})}
 catch(e){h5hStale=e.code==='VERSION_CONFLICT'}
 check(h5hStale,'H5H_STALE_VERSION_ACCEPTED');pass('h5h_auth_rpc_version_conflict');
 let h5hBlocked=false;try{blockOfficialIssuance()}catch(e){h5hBlocked=/OFFICIAL_ISSUANCE_BLOCKED/.test(e.message)}
 check(h5hBlocked,'H5H_ISSUANCE_NOT_BLOCKED');pass('h5h_official_issuance_blocked');

state.phase='PASS';log('FINAL',JSON.stringify(state));
}catch(e){state.phase='FAIL';state.error=e.message;log('FINAL',JSON.stringify(state))}finally{if(db)await db.end().catch(()=>{})}})();
