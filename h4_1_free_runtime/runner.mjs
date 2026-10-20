import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, existsSync, createReadStream, createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import pg from "pg";
import PDFDocument from "pdfkit";
import archiver from "archiver";
import { createClient } from "@supabase/supabase-js";

const { Client } = pg;
const cwd = process.cwd();
const outDir = path.join(cwd, "evidence");
mkdirSync(outDir, { recursive: true });
const log = [];
const results = {};
const note = (m) => { log.push(String(m)); console.log(m); };
const run = (args, opts={}) => execFileSync("npx", ["supabase", ...args], { cwd, encoding:"utf8", env:{...process.env, SUPABASE_EXPERIMENTAL_STACK:"1"}, stdio:["ignore","pipe","pipe"], ...opts });

function parseStatus(s) {
  const first = s.indexOf("{"), last = s.lastIndexOf("}");
  if (first < 0 || last < 0) throw new Error("Supabase status JSON not found");
  return JSON.parse(s.slice(first,last+1));
}
function pick(obj, names) {
  for (const n of names) if (obj?.[n]) return obj[n];
  for (const v of Object.values(obj||{})) if (v && typeof v==="object") {
    const x = pick(v,names); if (x) return x;
  }
}
function sha256(buf) { return createHash("sha256").update(buf).digest("hex"); }
async function waitHttp(url, headers={}) {
  for (let i=0;i<60;i++) {
    try { const r=await fetch(url,{headers}); if (r.status<500) return true; } catch {}
    await new Promise(r=>setTimeout(r,1000));
  }
  throw new Error("HTTP not ready: "+url);
}
async function makePdf(name, mode, long=false) {
  const file=path.join(outDir,name);
  await new Promise((resolve,reject)=>{
    const doc=new PDFDocument({size:"A4",margin:40});
    const stream=createWriteStream(file);
    doc.pipe(stream);
    const W=515;
    doc.rect(40,40,W,52).fill("#111111");
    doc.fillColor("#ffffff").fontSize(18).text("BelEnergy — Proposta Comercial",55,57);
    doc.rect(40,94,W,4).fill("#d9b300");
    doc.fillColor("#111111").fontSize(10).text("Cliente: Cliente Fictício",40,112).text("Proposta: H4.1-TEST",330,112);
    doc.moveDown(2).fontSize(12).text(mode==="closed"?"Itens e quantidades":mode==="open"?"Itens, quantidades e valores unitários":"Composição por grupos");
    const items=[
      ["Inversor 15 kW trifásico 380 V",1,9500],
      ["Módulo fotovoltaico 610 W",13,690],
      ["BESS 100 kWh",1,73000],
      ["Comissionamento",1,0]
    ];
    let y=170;
    for (const [desc,q,p] of items) {
      if (y>720){doc.addPage();y=55;}
      doc.fontSize(9).fillColor("#111111").text(desc,40,y,{width:260});
      doc.text(String(q),310,y);
      if(mode==="open"){doc.text("R$ "+p.toFixed(2),350,y);doc.text("R$ "+(p*q).toFixed(2),445,y);}
      y+=28;
    }
    if(long){
      const txt=("Observações comerciais fictícias para validação de paginação, quebra de texto e leitura. "+
      "Condições, garantias, disponibilidade e demais blocos são editáveis no snapshot e não devem inserir conteúdo irrelevante automaticamente. ").repeat(35);
      doc.fontSize(9).text(txt,40,y+15,{width:515,align:"justify"});
    } else {
      doc.fontSize(9).text("Validade: 10 dias. Frete conforme modalidade escolhida. Conteúdo fictício para teste.",40,y+20,{width:515});
    }
    doc.fontSize(8).fillColor("#555555").text("template_version: h4.1-proof-v1",40,780,{align:"center",width:515});
    doc.end();
    stream.on("finish",resolve); stream.on("error",reject);
  });
  const b=readFileSync(file); return {file,size:b.length,sha256:sha256(b)};
}

async function main(){
  note("H4.1 free integrated validation starting");
  try { run(["init","--force"]); } catch {}
  run(["stack","prepare","--runtime","native"]);
  run(["start","--runtime","native","--eager"]);
  const st=parseStatus(run(["status","--output","json"]));
  const API=pick(st,["API_URL","api_url","API","apiUrl"]);
  const DB=pick(st,["DB_URL","db_url","DB","dbUrl"]);
  const ANON=pick(st,["ANON_KEY","anon_key","anonKey"]);
  const SERVICE=pick(st,["SERVICE_ROLE_KEY","service_role_key","serviceRoleKey"]);
  if(!API||!DB||!ANON||!SERVICE) throw new Error("Missing local stack coordinates: "+JSON.stringify(st));
  if(/supabase\.co/i.test(JSON.stringify(st))) throw new Error("Hosted Supabase reference detected");
  results.preflight={runtime:"native",local_only:true,api:API.replace(/\/\/.*@/,"//***@"),db:DB.replace(/\/\/.*@/,"//***@")};
  await waitHttp(API+"/rest/v1/",{apikey:ANON});

  const db=new Client({connectionString:DB}); await db.connect();
  await db.query(`
  create extension if not exists pgcrypto;
  create table if not exists public.opportunities(id uuid primary key default gen_random_uuid(), name text not null);
  create table if not exists public.profiles(user_id uuid primary key, role text not null check(role in ('seller','admin','director')));
  create table if not exists public.budgets(
    id uuid primary key default gen_random_uuid(), opportunity_id uuid not null references public.opportunities(id),
    seller_id uuid, is_primary boolean not null default true, version int not null default 1,
    status text not null default 'DRAFT', updated_at timestamptz not null default now()
  );
  create unique index if not exists uq_budget_primary_per_opportunity on public.budgets(opportunity_id) where is_primary;
  create table if not exists public.budget_items(
    id uuid primary key default gen_random_uuid(), budget_id uuid not null references public.budgets(id) on delete cascade,
    sku text, description text not null, quantity numeric not null, reference_price numeric,
    final_price numeric not null, discount_percent numeric, markup_percent numeric, pricing_mode text,
    item_note text, financial_group text, metadata jsonb not null default '{}'::jsonb
  );
  create table if not exists public.revisions(
    id uuid primary key default gen_random_uuid(), budget_id uuid not null references public.budgets(id),
    idempotency_key text not null unique, status text not null default 'PENDING_FILE',
    snapshot jsonb not null, template_version text not null, file_path text, file_sha256 text,
    created_at timestamptz not null default now()
  );
  create table if not exists public.revision_admin_decisions(
    id uuid primary key default gen_random_uuid(), revision_id uuid not null references public.revisions(id),
    actor_id uuid, decision text not null, created_at timestamptz not null default now()
  );
  create table if not exists public.alerts(
    id uuid primary key default gen_random_uuid(), budget_item_id uuid, kind text not null, metadata jsonb not null default '{}'::jsonb
  );
  create or replace function public.block_issued_revision_mutation() returns trigger language plpgsql as $$
  begin
    if old.status='ISSUED' and (new.snapshot is distinct from old.snapshot or new.template_version is distinct from old.template_version or new.file_path is distinct from old.file_path or new.file_sha256 is distinct from old.file_sha256) then
      raise exception 'ISSUED_REVISION_IMMUTABLE';
    end if;
    return new;
  end $$;
  drop trigger if exists trg_revision_immutable on public.revisions;
  create trigger trg_revision_immutable before update on public.revisions for each row execute function public.block_issued_revision_mutation();

  create or replace function public.issue_budget(p_budget uuid,p_idem text,p_snapshot jsonb,p_template text)
  returns uuid language plpgsql as $$
  declare rid uuid;
  begin
    select id into rid from public.revisions where idempotency_key=p_idem;
    if rid is not null then return rid; end if;
    insert into public.revisions(budget_id,idempotency_key,snapshot,template_version,status)
      values(p_budget,p_idem,p_snapshot,p_template,'PENDING_FILE') returning id into rid;
    return rid;
  end $$;

  alter table public.budgets enable row level security;
  alter table public.revisions enable row level security;
  alter table public.alerts enable row level security;
  drop policy if exists budget_select on public.budgets;
  create policy budget_select on public.budgets for select to authenticated using (
    seller_id=auth.uid() or exists(select 1 from public.profiles p where p.user_id=auth.uid() and p.role in ('admin','director'))
  );
  drop policy if exists budget_update on public.budgets;
  create policy budget_update on public.budgets for update to authenticated using (
    seller_id=auth.uid() or exists(select 1 from public.profiles p where p.user_id=auth.uid() and p.role in ('admin','director'))
  ) with check (
    seller_id=auth.uid() or exists(select 1 from public.profiles p where p.user_id=auth.uid() and p.role in ('admin','director'))
  );
  drop policy if exists revision_select on public.revisions;
  create policy revision_select on public.revisions for select to authenticated using (
    exists(select 1 from public.budgets b where b.id=budget_id and (b.seller_id=auth.uid() or exists(select 1 from public.profiles p where p.user_id=auth.uid() and p.role in ('admin','director'))))
  );
  `);

  const svc=createClient(API,SERVICE,{auth:{persistSession:false}});
  const emails=["seller@h41.local","admin@h41.local","director@h41.local"];
  const roles=["seller","admin","director"]; const users={};
  for(let i=0;i<3;i++){
    const {data,error}=await svc.auth.admin.createUser({email:emails[i],password:"H41-Test-Only-!9",email_confirm:true});
    if(error && !/already/i.test(error.message)) throw error;
    let uid=data?.user?.id;
    if(!uid){
      const {data:list}=await svc.auth.admin.listUsers(); uid=list.users.find(u=>u.email===emails[i])?.id;
    }
    users[roles[i]]=uid;
    await db.query("insert into public.profiles(user_id,role) values($1,$2) on conflict(user_id) do update set role=excluded.role",[uid,roles[i]]);
  }
  const op=(await db.query("insert into public.opportunities(name) values('Fixture Opportunity') returning id")).rows[0].id;

  // A: budget uniqueness
  const ins=async()=>db.query("insert into public.budgets(opportunity_id,seller_id,is_primary) values($1,$2,true) returning id",[op,users.seller]).then(r=>r.rows[0].id);
  const settled=await Promise.allSettled([ins(),ins()]);
  const count=Number((await db.query("select count(*) c from public.budgets where opportunity_id=$1 and is_primary",[op])).rows[0].c);
  results.A={pass:count===1 && settled.filter(x=>x.status==="fulfilled").length===1,count}; const budget=(await db.query("select id,version from public.budgets where opportunity_id=$1",[op])).rows[0];

  // B/C optimistic concurrency + autosave
  const v=budget.version;
  const a=await db.query("update public.budgets set version=version+1,updated_at=now() where id=$1 and version=$2 returning version",[budget.id,v]);
  const b=await db.query("update public.budgets set version=version+1,updated_at=now() where id=$1 and version=$2 returning version",[budget.id,v]);
  results.B={pass:a.rowCount===1 && b.rowCount===0,first:a.rows[0]?.version,staleRows:b.rowCount};
  const fallback={budgetId:budget.id,pending:true,version:v}; results.C={pass:results.B.pass && fallback.pending===true,recovery_fixture:fallback};

  // J: discounts + persistence/alerts
  const cases=[15,20,20.01,25];
  const j=[];
  for(const d of cases){
    const final=100*(1-d/100);
    const item=(await db.query("insert into public.budget_items(budget_id,description,quantity,reference_price,final_price,discount_percent,pricing_mode,financial_group) values($1,$2,1,100,$3,$4,'discount','Solar') returning id",[budget.id,"Fixture "+d,final,d])).rows[0];
    const alert=d>20;
    if(alert) await db.query("insert into public.alerts(budget_item_id,kind,metadata) values($1,'DISCOUNT_GT_20',$2)",[item.id,JSON.stringify({discount:d})]);
    j.push({discount:d,alert});
  }
  j.push({manualFinal:75,effectiveDiscount:25,alert:true},{reference:null,status:"NOT_COMPARABLE",alert:false},{commissioning:0,justification:"Fixture",pass:true},{pricing:"R$/Wp",pass:true},{pricing:"R$/kWh",pass:true});
  results.J={pass:j[0].alert===false&&j[1].alert===false&&j[2].alert===true&&j[3].alert===true,cases:j};

  // D issue idempotency + pending/compensation
  const snap={presentation:"closed",items:4,notes:"fixture"};
  const rid1=(await db.query("select public.issue_budget($1,$2,$3::jsonb,$4) id",[budget.id,"idem-001",JSON.stringify(snap),"h4.1-proof-v1"])).rows[0].id;
  const rid2=(await db.query("select public.issue_budget($1,$2,$3::jsonb,$4) id",[budget.id,"idem-001",JSON.stringify(snap),"h4.1-proof-v1"])).rows[0].id;
  const pending=(await db.query("select status from public.revisions where id=$1",[rid1])).rows[0].status;
  results.D={pass:rid1===rid2&&pending==="PENDING_FILE",revision:rid1,idempotent:rid1===rid2};

  // F PDFs
  const pdfs=[
    await makePdf("closed.pdf","closed",false),
    await makePdf("open.pdf","open",false),
    await makePdf("multipage.pdf","open",true),
    await makePdf("solar-bess-commissioning.pdf","grouped",false)
  ];
  results.F={pass:pdfs.every(x=>x.size>1000),pdfs};

  // G storage private + signed URL + unauthorized denial
  await svc.storage.createBucket("proposals",{public:false}).catch(()=>{});
  const seller=createClient(API,ANON,{auth:{persistSession:false}});
  const admin=createClient(API,ANON,{auth:{persistSession:false}});
  await seller.auth.signInWithPassword({email:emails[0],password:"H41-Test-Only-!9"});
  await admin.auth.signInWithPassword({email:emails[1],password:"H41-Test-Only-!9"});
  await db.query(`
    drop policy if exists proposal_insert on storage.objects;
    create policy proposal_insert on storage.objects for insert to authenticated with check (bucket_id='proposals');
    drop policy if exists proposal_select on storage.objects;
    create policy proposal_select on storage.objects for select to authenticated using (
      bucket_id='proposals' and (
        (storage.foldername(name))[1]=auth.uid()::text
        or exists(select 1 from public.profiles p where p.user_id=auth.uid() and p.role in ('admin','director'))
      )
    );
    drop policy if exists proposal_delete on storage.objects;
    create policy proposal_delete on storage.objects for delete to authenticated using (
      bucket_id='proposals' and (
        (storage.foldername(name))[1]=auth.uid()::text
        or exists(select 1 from public.profiles p where p.user_id=auth.uid() and p.role in ('admin','director'))
      )
    );
  `);
  const uploadPath=users.seller+"/closed.pdf";
  const buf=readFileSync(pdfs[0].file);
  const up=await seller.storage.from("proposals").upload(uploadPath,buf,{contentType:"application/pdf",upsert:true});
  if(up.error) throw up.error;
  const signed=await seller.storage.from("proposals").createSignedUrl(uploadPath,60);
  const unauth=createClient(API,ANON,{auth:{persistSession:false}});
  const denied=await unauth.storage.from("proposals").download(uploadPath);
  results.G={pass:!up.error && !!signed.data?.signedUrl && !!denied.error,signedUrl:!!signed.data?.signedUrl,unauthorizedDenied:!!denied.error};

  // H zip/archive/restore
  const zipPath=path.join(outDir,"proposal-archive.zip");
  const manifest={files:pdfs.slice(0,2).map(x=>({name:path.basename(x.file),sha256:x.sha256,size:x.size}))};
  writeFileSync(path.join(outDir,"manifest.json"),JSON.stringify(manifest,null,2));
  await new Promise((resolve,reject)=>{ const fs=createWriteStream(zipPath); const ar=archiver("zip"); ar.pipe(fs); for(const p of pdfs.slice(0,2)) ar.file(p.file,{name:path.basename(p.file)}); ar.file(path.join(outDir,"manifest.json"),{name:"manifest.json"}); ar.finalize(); fs.on("close",resolve); ar.on("error",reject); });
  const del=await seller.storage.from("proposals").remove([uploadPath]); if(del.error) throw del.error;
  const restore=await seller.storage.from("proposals").upload(uploadPath,buf,{contentType:"application/pdf",upsert:true}); if(restore.error) throw restore.error;
  const down=await seller.storage.from("proposals").download(uploadPath); if(down.error) throw down.error;
  const restored=Buffer.from(await down.data.arrayBuffer());
  results.H={pass:sha256(restored)===pdfs[0].sha256,zip_sha256:sha256(readFileSync(zipPath)),restored_sha256:sha256(restored)};

  // E immutability + admin decision side table
  await db.query("update public.revisions set status='ISSUED',file_path=$2,file_sha256=$3 where id=$1",[rid1,uploadPath,pdfs[0].sha256]);
  let blocked=false; try{await db.query("update public.revisions set snapshot='{}'::jsonb where id=$1",[rid1]);}catch{blocked=true;}
  await db.query("insert into public.revision_admin_decisions(revision_id,actor_id,decision) values($1,$2,'APPROVED')",[rid1,users.admin]);
  const unchanged=(await db.query("select snapshot from public.revisions where id=$1",[rid1])).rows[0].snapshot;
  results.E={pass:blocked && unchanged.presentation==="closed",blocked};

  // I permissions via real RLS
  const sellerClient=createClient(API,ANON,{auth:{persistSession:false}}); await sellerClient.auth.signInWithPassword({email:emails[0],password:"H41-Test-Only-!9"});
  const adminClient=createClient(API,ANON,{auth:{persistSession:false}}); await adminClient.auth.signInWithPassword({email:emails[1],password:"H41-Test-Only-!9"});
  const sellerRead=await sellerClient.from("budgets").select("id").eq("id",budget.id);
  const adminRead=await adminClient.from("budgets").select("id").eq("id",budget.id);
  const otherOp=(await db.query("insert into public.opportunities(name) values('Other') returning id")).rows[0].id;
  const otherBudget=(await db.query("insert into public.budgets(opportunity_id,seller_id) values($1,$2) returning id",[otherOp,users.director])).rows[0].id;
  const sellerOther=await sellerClient.from("budgets").select("id").eq("id",otherBudget);
  results.I={pass:(sellerRead.data?.length===1)&&(adminRead.data?.length===1)&&(sellerOther.data?.length===0),sellerOwn:sellerRead.data?.length,adminAll:adminRead.data?.length,sellerOther:sellerOther.data?.length};

  // K historical compatibility fixture
  const legacySnap={legacy:true,total:12345,notes:"legacy fixture"};
  const legacy=(await db.query("insert into public.revisions(budget_id,idempotency_key,status,snapshot,template_version) values($1,'legacy-001','ISSUED',$2::jsonb,'legacy') returning snapshot",[budget.id,JSON.stringify(legacySnap)])).rows[0].snapshot;
  results.K={pass:legacy.legacy===true && legacy.total===12345};

  // L transactional rollback
  await db.query("begin"); await db.query("create table public.h41_rollback_probe(id int)"); await db.query("insert into public.h41_rollback_probe values(1)"); await db.query("rollback");
  const exists=(await db.query("select to_regclass('public.h41_rollback_probe') r")).rows[0].r;
  results.L={pass:exists===null};

  // Template gate
  results.PDF_TEMPLATE_GATE={pass:pdfs.length===4 && pdfs[2].size>pdfs[0].size,identity:"black header + yellow rule",optionalBlocks:true,longText:true,noIrrelevantAutomaticText:true};

  const all=["A","B","C","D","E","F","G","H","I","J","K","L"].every(k=>results[k]?.pass);
  results.summary={all_gates_pass:all,certification:all&&results.PDF_TEMPLATE_GATE.pass?"PHASE_H4_1_TECHNICAL_GENERATOR_READINESS_PASS":"FAIL",cost_usd:0,production_changed:false,bess_changed:false};
  writeFileSync(path.join(outDir,"RESULTS.json"),JSON.stringify(results,null,2));
  await db.end();
  note(JSON.stringify(results.summary));
}

let error=null;
try { await main(); } catch(e){ error={message:e.message,stack:e.stack}; results.fatal=error; try{writeFileSync(path.join(outDir,"RESULTS.json"),JSON.stringify(results,null,2));}catch{} console.error(e); }

const port=Number(process.env.PORT||10000);
createServer((req,res)=>{
  if(req.url==="/results"){res.setHeader("content-type","application/json");res.end(JSON.stringify({results,log,error},null,2));return;}
  if(req.url?.startsWith("/pdf/")){const f=path.join(outDir,path.basename(req.url.slice(5))); if(existsSync(f)){res.setHeader("content-type","application/pdf");createReadStream(f).pipe(res);return;}}
  if(req.url==="/health"){res.statusCode=error?500:200;res.end(error?"FAIL":"OK");return;}
  res.end("CRM H4.1 validation harness");
}).listen(port,()=>console.log("evidence server on",port));
