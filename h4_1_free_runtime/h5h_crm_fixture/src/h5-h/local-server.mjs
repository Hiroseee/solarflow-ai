// H5-H local-only fixture server. Not a public service or production/Auth/Storage route.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,sep,extname} from 'node:path';
import {IntegratedFixtureJourney} from './fixture-journey.mjs';
const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const respond=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value))};
function input(req){
 return new Promise((ok,fail)=>{
  let raw='',length=0;
  req.on('data',chunk=>{length+=chunk.length;if(length>300000){fail(Error('FIXTURE_BODY_TOO_LARGE'));req.destroy();return;}raw+=chunk.toString('utf8')});
  req.on('end',()=>{try{ok(JSON.parse(raw))}catch{fail(Error('INVALID_JSON'))}});
  req.on('error',fail);
 });
}
export function createIntegratedFixtureServer({journey=new IntegratedFixtureJourney()}={}){
 return createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://localhost');
   if(url.pathname==='/api/official-issuance'){
    respond(res,403,{error:'OFFICIAL_ISSUANCE_BLOCKED_PENDING_CANONICAL_AND_STORAGE_GATES'});return;
   }
   if(url.pathname==='/api/fixture-revisions'&&req.method==='POST'){
    const row=await journey.record(await input(req));respond(res,201,row);return;
   }
   if(url.pathname==='/api/fixture-revisions'&&req.method==='GET'){
    respond(res,200,{demoOnly:true,persistentAcrossServerRestart:false,rows:journey.list(url.searchParams.get('budgetId'))});return;
   }
   const match=url.pathname.match(/^\/api\/fixture-revisions\/([a-z0-9_-]+)\/([a-z0-9_-]+)\/pdf$/i);
   if(match&&req.method==='GET'){
    const bytes=await journey.pdf(match[1],match[2]);
    res.writeHead(200,{'Content-Type':'application/pdf','X-Content-Type-Options':'nosniff','Cache-Control':'no-store',
      'Content-Disposition':'attachment; filename="DOCUMENTO_TESTE_SEM_VALIDADE.pdf"'});
    res.end(bytes);return;
   }
   if(url.pathname.startsWith('/api/')){respond(res,404,{error:'UNKNOWN_FIXTURE_ROUTE'});return;}
   if(req.method!=='GET'&&req.method!=='HEAD'){respond(res,405,{error:'METHOD_NOT_ALLOWED'});return;}
   if(url.pathname==='/'){res.writeHead(302,{Location:'/demo/h5-h.html'});res.end();return;}
   // Strict allowlist of browser code folders, no directory listing or external file access.
   if(!/^\/(?:demo\/h5-h\.html|src\/h5-[b-e]\/[-a-z0-9]+\.mjs|src\/h5-h\/(?:fictional-catalog|isolated-local-adapter)\.mjs)$/i.test(url.pathname)){
    respond(res,404,{error:'RESOURCE_NOT_EXPOSED'});return;
   }
   const target=resolve(root,'.'+url.pathname);
   if(!target.startsWith(root+sep))throw Error('INVALID_LOCAL_PATH');
   const bytes=await readFile(target);
   res.writeHead(200,{'Content-Type':mime[extname(target)]||'application/octet-stream',
      'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});
   if(req.method==='HEAD')res.end();else res.end(bytes);
  }catch(err){const msg=err?.code==='ENOENT'?'FIXTURE_ASSET_MISSING':err?.message||'FIXTURE_FAILURE';
   respond(res,msg==='FIXTURE_ASSET_MISSING'?404:400,{error:msg});}
 });
}
const main=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(main){
 const host='127.0.0.1',port=Number(process.env.H5H_PORT||8000);
 if(!Number.isInteger(port)||port<1024||port>65535)throw Error('INVALID_DEMO_PORT');
 createIntegratedFixtureServer().listen(port,host,()=>console.log('H5-H DEMO LOCAL ONLY: http://127.0.0.1:'+port+'/demo/h5-h.html'));
}
