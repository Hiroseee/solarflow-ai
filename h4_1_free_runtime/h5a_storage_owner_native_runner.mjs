import {execFile} from 'node:child_process';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {createClient} from '@supabase/supabase-js';
const S={phase:'BOOT',isolation:'NOT_PROVEN',storage_contract:'NOT_TESTED',results:{},error:null};
createServer((_q,r)=>{r.setHeader('content-type','application/json');r.end(JSON.stringify(S));}).listen(Number(process.env.PORT||10000),'0.0.0.0');
const log=(...x)=>console.log('[H5A_STORAGE]',...x),assert=(v,m)=>{if(!v)throw Error(m)};
const hash=b=>createHash('sha256').update(b).digest('hex');
function run(a,ms=160000){return new Promise((ok,bad)=>{log('BEGIN',a.join(' '));const started=Date.now();execFile('npx',['--no-install','supabase',...a],{env:{...process.env,SUPABASE_EXPERIMENTAL_STACK:'1'},timeout:ms,maxBuffer:5e6},(e,out,err)=>{log('END',a[0],Date.now()-started,e?'FAIL':'PASS');e?bad(Error(e.message+' '+(err||'').slice(-450))):ok(out)})})}
(async()=>{let db;try{
assert(!Object.keys(process.env).some(k=>/SUPABASE_(ACCESS_TOKEN|DB_PASSWORD|SERVICE_ROLE_KEY)|BESS.*(SECRET|TOKEN|PASSWORD)|CRM.*(SECRET|TOKEN|PASSWORD)/i.test(k)),'SENSITIVE_ENV_PRESENT');
await run(['init','--force'],45000);
await run(['start','--runtime','native','--preparation','on-demand','--exclude','realtime,functions,studio,mail,analytics,pooler'],160000);
const raw=await run(['status','--output-format','json'],45000),j=JSON.parse(raw.slice(raw.indexOf('{'),raw.lastIndexOf('}')+1));
assert(j.runtime==='native'&&!JSON.stringify(j).includes('supabase.co'),'NON_ISOLATED');
const dbUrl=j.env?.DB_URL||j.endpoints?.database?.sql?.url,api=j.env?.API_URL||j.endpoints?.api?.url||j.endpoints?.rest?.url;
assert(dbUrl&&api&&['localhost','127.0.0.1'].includes(new URL(dbUrl).hostname)&&['localhost','127.0.0.1'].includes(new URL(api).hostname),'NON_LOCAL_ENDPOINTS');
const anon=j.env?.ANON_KEY||j.env?.PUBLISHABLE_KEY,service=j.env?.SERVICE_ROLE_KEY||j.env?.SECRET_KEY;assert(anon&&service,'LOCAL_KEYS_MISSING');
db=new pg.Client({connectionString:dbUrl,connectionTimeoutMillis:13000});await db.connect();await db.query('select 1');S.isolation='PASS';log('ISOLATION_PASS',new URL(dbUrl).hostname);
const svc=createClient(api,service,{auth:{persistSession:false,autoRefreshToken:false}});
const users=[];for(let i=1;i<=2;i++){const email='h5a-storage-seller'+i+'-'+Date.now()+'@example.test';const {data,error}=await svc.auth.admin.createUser({email,password:'StorageFixture!234',email_confirm:true});assert(!error&&data?.user?.id,'CREATE_USER_'+i+':'+error?.message);users.push({id:data.user.id,email})}
async function login(user){const c=createClient(api,anon,{auth:{persistSession:false,autoRefreshToken:false}});const {data,error}=await c.auth.signInWithPassword({email:user.email,password:'StorageFixture!234'});assert(!error&&data?.session?.access_token,'LOGIN_FAIL:'+error?.message);return c}
const [seller1,seller2]=await Promise.all(users.map(login));
const bucket='h5a-private-proofs';const {error:createError}=await svc.storage.createBucket(bucket,{public:false,fileSizeLimit:1048576});assert(!createError,'PRIVATE_BUCKET_FAIL:'+createError?.message);
await db.query(`create policy h5a_owner_select on storage.objects for select to authenticated using(bucket_id='h5a-private-proofs' and split_part(name,'/',1)=(select auth.uid())::text)`);
await db.query(`create policy h5a_owner_insert on storage.objects for insert to authenticated with check(bucket_id='h5a-private-proofs' and split_part(name,'/',1)=(select auth.uid())::text)`);
await db.query(`create policy h5a_owner_update on storage.objects for update to authenticated using(bucket_id='h5a-private-proofs' and split_part(name,'/',1)=(select auth.uid())::text) with check(bucket_id='h5a-private-proofs' and split_part(name,'/',1)=(select auth.uid())::text)`);
const path=users[0].id+'/budget-fictional-001/test.txt',data=Buffer.from('H5-A isolated storage proof', 'utf8');
let upload=await seller1.storage.from(bucket).upload(path,data,{contentType:'text/plain',upsert:false});assert(!upload.error,'OWNER_UPLOAD:'+upload.error?.message);
let dl=await seller1.storage.from(bucket).download(path);assert(!dl.error,'OWNER_DOWNLOAD:'+dl.error?.message);
const bytes=Buffer.from(await dl.data.arrayBuffer());assert(hash(bytes)===hash(data),'HASH_MISMATCH');
let anonC=createClient(api,anon,{auth:{persistSession:false,autoRefreshToken:false}});
const anonDl=await anonC.storage.from(bucket).download(path);assert(!!anonDl.error,'ANON_DOWNLOAD_ALLOWED');
const otherDl=await seller2.storage.from(bucket).download(path);assert(!!otherDl.error,'CROSS_SELLER_DOWNLOAD_ALLOWED');
const otherWrite=await seller2.storage.from(bucket).upload(path,Buffer.from('attack'),{contentType:'text/plain',upsert:true});assert(!!otherWrite.error,'CROSS_SELLER_OVERWRITE_ALLOWED');
const ownOverwrite=await seller1.storage.from(bucket).upload(path,Buffer.from('new'),{contentType:'text/plain',upsert:false});assert(!!ownOverwrite.error,'OVERWRITE_WITHOUT_UPSERT_ALLOWED');
const verify=await seller1.storage.from(bucket).download(path);assert(!verify.error&&hash(Buffer.from(await verify.data.arrayBuffer()))===hash(data),'PROTECTED_OBJECT_MODIFIED');
S.storage_contract='PASS_PRIVATE_OWNER_PREFIX_JWT';S.results={private_bucket:true,owner_upload:true,owner_download:true,exact_bytes:true,anonymous_denied:true,cross_owner_download_denied:true,cross_owner_overwrite_denied:true,overwrite_without_upsert_denied:true,associated_budget:'PATH_LABEL_ONLY_NOT_DB_VERIFIED'};S.phase='DONE';log('RESULT',JSON.stringify(S));
}catch(e){S.error=e.message;S.phase='FAIL';log('FAIL',e.message)}finally{if(db)await db.end().catch(()=>{});log('FINAL',JSON.stringify(S));}})();
