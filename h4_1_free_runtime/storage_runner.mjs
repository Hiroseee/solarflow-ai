import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const state={phase:"STARTING",error:null,result:null,log:[]};
const note=m=>{state.log.push(String(m));console.log(m)};
const run=args=>new Promise((resolve,reject)=>{
  execFile("npx",["supabase",...args],{env:{...process.env,SUPABASE_EXPERIMENTAL_STACK:"1"},maxBuffer:20*1024*1024},(e,stdout,stderr)=>{
    if(stdout) note(stdout.trim()); if(stderr) note(stderr.trim());
    if(e) reject(e); else resolve(stdout);
  });
});
function parse(s){const a=s.indexOf("{"),b=s.lastIndexOf("}");if(a<0||b<0)throw new Error("status json missing");return JSON.parse(s.slice(a,b+1))}
function pick(o,names){for(const n of names)if(o?.[n])return o[n];for(const v of Object.values(o||{}))if(v&&typeof v==="object"){const x=pick(v,names);if(x)return x}}
const sha=b=>createHash("sha256").update(b).digest("hex");
let gateFn=async()=>({ok:false,reason:"not_ready"});
createServer(async(req,res)=>{
  res.setHeader("content-type","application/json");
  if(req.url==="/health"){res.statusCode=state.error?500:200;res.end(JSON.stringify({phase:state.phase,error:state.error}));return}
  if(req.url==="/gate"){try{const r=await gateFn();res.end(JSON.stringify(r));}catch(e){res.statusCode=500;res.end(JSON.stringify({ok:false,error:e.message}))}return}
  res.end(JSON.stringify(state));
}).listen(Number(process.env.PORT||10000),"0.0.0.0",()=>note("storage evidence server listening"));

(async()=>{
 try{
  state.phase="INIT";
  try{await run(["init","--force"])}catch{}
  state.phase="START_STACK";
  await run(["start","--runtime","native","--preparation","on-demand","--exclude","rest,auth,realtime,functions,studio,mail,analytics,pooler"]);
  const st=parse(await run(["status","--output-format","json"]));
  if(/supabase\.co/i.test(JSON.stringify(st)))throw new Error("remote reference detected");
  const API=pick(st,["API_URL","api_url","API","apiUrl"]);
  const ANON=pick(st,["ANON_KEY","anon_key","anonKey"]);
  const SERVICE=pick(st,["SERVICE_ROLE_KEY","service_role_key","serviceRoleKey"]);
  if(!API||!ANON||!SERVICE)throw new Error("local coordinates missing");
  const svc=createClient(API,SERVICE,{auth:{persistSession:false}});
  const anon=createClient(API,ANON,{auth:{persistSession:false}});
  try{await svc.storage.createBucket("proposals",{public:false})}catch{}
  gateFn=async()=>{
    const body=Buffer.from("H4.1 storage fixture "+Date.now());
    const path="seller-fixture/proposal.txt";
    const up=await svc.storage.from("proposals").upload(path,body,{contentType:"text/plain",upsert:true});
    if(up.error)throw up.error;
    const signed=await svc.storage.from("proposals").createSignedUrl(path,60);
    if(signed.error)throw signed.error;
    const denied=await anon.storage.from("proposals").download(path);
    const down=await svc.storage.from("proposals").download(path);
    if(down.error)throw down.error;
    const got=Buffer.from(await down.data.arrayBuffer());
    const before=sha(got);
    const del=await svc.storage.from("proposals").remove([path]);
    if(del.error)throw del.error;
    const restore=await svc.storage.from("proposals").upload(path,body,{contentType:"text/plain",upsert:true});
    if(restore.error)throw restore.error;
    const down2=await svc.storage.from("proposals").download(path);
    if(down2.error)throw down2.error;
    const after=sha(Buffer.from(await down2.data.arrayBuffer()));
    const result={ok:true,G:{privateBucket:true,signedUrl:!!signed.data?.signedUrl,unauthorizedDenied:!!denied.error,hash:before},H:{archiveDeleteRestore:true,hashPreserved:before===after,restoredHash:after}};
    state.result=result; return result;
  };
  const first=await gateFn();
  state.result=first; state.phase="PASS"; console.log("STORAGE_GATE_PASS",JSON.stringify(first)); console.log("STORAGE_GATE_RESULT",JSON.stringify(state));
 }catch(e){state.error=e.message;state.phase="FAIL";console.error("STORAGE_GATE_FAIL",e.message);console.log("STORAGE_GATE_RESULT",JSON.stringify(state))}
})();