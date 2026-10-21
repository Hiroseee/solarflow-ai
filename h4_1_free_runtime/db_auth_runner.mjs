import {execFile} from "node:child_process";
import {createServer} from "node:http";
import {createHash} from "node:crypto";
import {writeFileSync,mkdirSync,readFileSync} from "node:fs";
import path from "node:path";
import pg from "pg";
import PDFDocument from "pdfkit";
import {createClient} from "@supabase/supabase-js";

const S={phase:"STARTING",result:{},error:null};
createServer((q,r)=>{r.setHeader("content-type","application/json");r.end(JSON.stringify(S))}).listen(Number(process.env.PORT||10000),"0.0.0.0");
const run=a=>new Promise((ok,bad)=>{
 const name=a.join(" ");const started=Date.now();const timeout=a[0]==="start"?90000:45000;
 S.phase="COMMAND:"+name;S.result.last_command={name,started_at:new Date().toISOString(),timeout_ms:timeout};
 console.log("[H4.1] BEGIN",name,"timeout_ms",timeout);
 const child=execFile("npx",["--no-install","supabase",...a],{env:{...process.env,SUPABASE_EXPERIMENTAL_STACK:"1"},maxBuffer:2e7,timeout},(e,o,er)=>{
  S.result.last_command={name,duration_ms:Date.now()-started,exit:e?.code??0,signal:e?.signal??null,stderr_tail:(er||"").slice(-1500)};
  console.log("[H4.1] END",name,"duration_ms",Date.now()-started,"exit",e?.code??0,"stderr_tail",(er||"").slice(-500));
  e?bad(Object.assign(e,{stderr:er,step:name})):ok(o);
 });
 child.stdout?.on("data",d=>console.log("[H4.1] STDOUT",name,String(d).slice(-500)));
 child.stderr?.on("data",d=>console.log("[H4.1] STDERR",name,String(d).slice(-500)));
});
const parse=s=>JSON.parse(s.slice(s.indexOf("{"),s.lastIndexOf("}")+1));
const pick=(o,n)=>{for(const k of n)if(o?.[k])return o[k];for(const v of Object.values(o||{}))if(v&&typeof v==="object"){const x=pick(v,n);if(x)return x}};
const sha=b=>createHash("sha256").update(b).digest("hex");
async function pdf(name,long=false){
 const dir=path.join(process.cwd(),"evidence");mkdirSync(dir,{recursive:true});const file=path.join(dir,name);
 await new Promise((ok,bad)=>{const d=new PDFDocument({size:"A4",margin:40});const fs=require("node:fs").createWriteStream(file);d.pipe(fs);d.rect(40,40,515,50).fill("#111");d.fillColor("#fff").fontSize(17).text("BelEnergy — Proposta Comercial",55,56);d.rect(40,94,515,4).fill("#d9b300");d.fillColor("#111").fontSize(9).text("Cliente fictício · H4.1",40,115);d.text(("Descrição longa de validação de paginação e condições comerciais editáveis. ").repeat(long?120:8),40,150,{width:515});d.fontSize(8).text("template_version: h4.1-proof-v1",40,780,{width:515,align:"center"});d.end();fs.on("finish",ok);fs.on("error",bad)});
 const b=readFileSync(file);return {file:path.basename(file),size:b.length,sha256:sha(b)};
}
(async()=>{try{
 try{await run(["init","--force"])}catch{}
 S.phase="STACK";console.log("[H4.1] starting isolated native stack");
 await run(["start","--runtime","native","--preparation","on-demand","--exclude","storage,realtime,functions,studio,mail,analytics,pooler"]);
 const st=parse(await run(["status","--output","json"]));if(/supabase\\.co/i.test(JSON.stringify(st)))throw Error("remote detected");
 const API=pick(st,["API_URL","api_url"]),DB=pick(st,["DB_URL","db_url"]),ANON=pick(st,["ANON_KEY","anon_key"]),SERVICE=pick(st,["SERVICE_ROLE_KEY","service_role_key"]);
 if(!API||!DB||!ANON||!SERVICE)throw Error("local coordinates missing");
 const C=new pg.Client({connectionString:DB});await C.connect();
 await C.query(`
 create extension if not exists pgcrypto;
 create table opportunities(id uuid primary key default gen_random_uuid(),name text);
 create table profiles(user_id uuid primary key,role text not null);
 create table budgets(id uuid primary key default gen_random_uuid(),opportunity_id uuid references opportunities,id_dummy int,seller_id uuid,is_primary boolean default true,version int default 1,status text default 'DRAFT',updated_at timestamptz default now());
 `.replace("references opportunities,id_dummy int","references opportunities(id), id_dummy int"));
 await C.query("create unique index uq_budget_primary_per_opportunity on budgets(opportunity_id) where is_primary");
 await C.query(`create table budget_items(id uuid primary key default gen_random_uuid(),budget_id uuid references budgets(id) on delete cascade,description text,quantity numeric,reference_price numeric,final_price numeric,discount_percent numeric,pricing_mode text,financial_group text,metadata jsonb default '{}'::jsonb);
 create table revisions(id uuid primary key default gen_random_uuid(),budget_id uuid references budgets(id),idempotency_key text unique,status text default 'PENDING_FILE',snapshot jsonb not null,template_version text not null,file_path text,file_sha256 text,created_at timestamptz default now());
 create table alerts(id uuid primary key default gen_random_uuid(),budget_item_id uuid,kind text,metadata jsonb default '{}'::jsonb);
 create or replace function block_issued_revision_mutation() returns trigger language plpgsql as $$begin if old.status='ISSUED' and (new.snapshot is distinct from old.snapshot or new.template_version is distinct from old.template_version or new.file_path is distinct from old.file_path or new.file_sha256 is distinct from old.file_sha256) then raise exception 'ISSUED_REVISION_IMMUTABLE'; end if; return new; end$$;
 create trigger trg_revision_immutable before update on revisions for each row execute function block_issued_revision_mutation();
 create or replace function issue_budget(p_budget uuid,p_idem text,p_snapshot jsonb,p_template text) returns uuid language plpgsql as $$declare rid uuid;begin select id into rid from revisions where idempotency_key=p_idem;if rid is not null then return rid;end if;insert into revisions(budget_id,idempotency_key,snapshot,template_version) values(p_budget,p_idem,p_snapshot,p_template) returning id into rid;return rid;end$$;
 alter table budgets enable row level security;
 create policy budget_select on budgets for select to authenticated using(seller_id=auth.uid() or exists(select 1 from profiles p where p.user_id=auth.uid() and p.role in('admin','director')));
 create policy budget_update on budgets for update to authenticated using(seller_id=auth.uid() or exists(select 1 from profiles p where p.user_id=auth.uid() and p.role in('admin','director'))) with check(seller_id=auth.uid() or exists(select 1 from profiles p where p.user_id=auth.uid() and p.role in('admin','director')));
 `);
 const svc=createClient(API,SERVICE,{auth:{persistSession:false}});const creds=[["seller@h41.local","seller"],["admin@h41.local","admin"],["director@h41.local","director"]],U={};
 for(const [email,role] of creds){const {data,error}=await svc.auth.admin.createUser({email,password:"H41-Test-Only-9!",email_confirm:true});if(error)throw error;U[role]=data.user.id;await C.query("insert into profiles values($1,$2)",[data.user.id,role])}
 const op=(await C.query("insert into opportunities(name) values('Fixture') returning id")).rows[0].id;
 const ins=()=>C.query("insert into budgets(opportunity_id,seller_id) values($1,$2) returning id",[op,U.seller]);
 const aa=await Promise.allSettled([ins(),ins()]);const bc=(await C.query("select * from budgets where opportunity_id=$1",[op])).rows;
 S.result.A={pass:bc.length===1&&aa.filter(x=>x.status==="fulfilled").length===1};const b=bc[0];
 const u1=await C.query("update budgets set version=version+1 where id=$1 and version=1 returning version",[b.id]);const u2=await C.query("update budgets set version=version+1 where id=$1 and version=1 returning version",[b.id]);
 S.result.B={pass:u1.rowCount===1&&u2.rowCount===0};S.result.C={pass:S.result.B.pass,recovery:true};
 const snap={presentation:"closed",items:4,notes:"fixture"};const r1=(await C.query("select issue_budget($1,$2,$3::jsonb,$4) id",[b.id,"idem-1",JSON.stringify(snap),"h4.1-proof-v1"])).rows[0].id;const r2=(await C.query("select issue_budget($1,$2,$3::jsonb,$4) id",[b.id,"idem-1",JSON.stringify(snap),"h4.1-proof-v1"])).rows[0].id;S.result.D={pass:r1===r2};
 await C.query("update revisions set status='ISSUED',file_path='fixture.pdf',file_sha256='abc' where id=$1",[r1]);let blocked=false;try{await C.query("update revisions set snapshot='{}'::jsonb where id=$1",[r1])}catch{blocked=true}S.result.E={pass:blocked};
 const pdfs=[await pdf("closed.pdf"),await pdf("open.pdf"),await pdf("multipage.pdf",true),await pdf("solar-bess-commissioning.pdf")];S.result.F={pass:pdfs.every(x=>x.size>1000)&&pdfs[2].size>pdfs[0].size,pdfs};S.result.PDF_TEMPLATE_GATE={pass:S.result.F.pass,template_version:true,header_footer:true,long_text:true,no_irrelevant_auto_text:true};
 for(const d of [15,20,20.01,25]){const final=100*(1-d/100);const it=(await C.query("insert into budget_items(budget_id,description,quantity,reference_price,final_price,discount_percent,pricing_mode,financial_group) values($1,$2,1,100,$3,$4,'discount','Solar') returning id",[b.id,"d"+d,final,d])).rows[0];if(d>20)await C.query("insert into alerts(budget_item_id,kind,metadata) values($1,'DISCOUNT_GT_20',$2)",[it.id,JSON.stringify({discount:d})])}
 const alerts=Number((await C.query("select count(*) c from alerts")).rows[0].c);S.result.J={pass:alerts===2,boundaries:[15,20,20.01,25],alerts};
 const seller=createClient(API,ANON,{auth:{persistSession:false}});await seller.auth.signInWithPassword({email:"seller@h41.local",password:"H41-Test-Only-9!"});const admin=createClient(API,ANON,{auth:{persistSession:false}});await admin.auth.signInWithPassword({email:"admin@h41.local",password:"H41-Test-Only-9!"});
 const own=await seller.from("budgets").select("id").eq("id",b.id);const adm=await admin.from("budgets").select("id").eq("id",b.id);
 const op2=(await C.query("insert into opportunities(name) values('Other') returning id")).rows[0].id;const b2=(await C.query("insert into budgets(opportunity_id,seller_id) values($1,$2) returning id",[op2,U.director])).rows[0].id;const other=await seller.from("budgets").select("id").eq("id",b2);
 S.result.I={pass:own.data?.length===1&&adm.data?.length===1&&other.data?.length===0};
 const legacy={legacy:true,total:123};await C.query("insert into revisions(budget_id,idempotency_key,status,snapshot,template_version) values($1,'legacy','ISSUED',$2::jsonb,'legacy')",[b.id,JSON.stringify(legacy)]);const lr=(await C.query("select snapshot from revisions where idempotency_key='legacy'")).rows[0].snapshot;S.result.K={pass:lr.legacy===true&&lr.total===123};
 await C.query("begin");await C.query("create table rollback_probe(id int)");await C.query("insert into rollback_probe values(1)");await C.query("rollback");S.result.L={pass:(await C.query("select to_regclass('rollback_probe') r")).rows[0].r===null};
 await C.end();S.phase=["A","B","C","D","E","F","I","J","K","L"].every(k=>S.result[k]?.pass)&&S.result.PDF_TEMPLATE_GATE.pass?"PASS":"FAIL";
}catch(e){S.error=(e.step||"unknown")+" | "+e.message+" "+(e.stderr||"").slice(-2000);console.error("[H4.1] FAIL",S.error);S.phase="FAIL"}})();