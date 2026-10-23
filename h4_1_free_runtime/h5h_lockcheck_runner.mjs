// Generate lockfile for the exact CRM package in isolated FREE helper. No paid service.
import {createServer} from 'node:http';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
const st={phase:'STARTING',npmCi:false,lockReady:false,code:null,error:null};
createServer((_q,r)=>{r.setHeader('Content-Type','application/json');r.end(JSON.stringify(st))}).listen(Number(process.env.PORT||10000),'0.0.0.0');
const call=(args,cwd)=>new Promise((ok,no)=>execFile('npm',args,{cwd,timeout:180000,maxBuffer:1e6},(err,stdout,stderr)=>err?no(Error(err.message+' '+stderr.slice(-300))):ok(stdout)));
const src={
 name:'crm-bess',version:'1.0.0-foundation.1',private:true,license:'UNLICENSED',
 engines:{node:'22.x'},scripts:{'demo:h5-h':'node src/h5-h/local-server.mjs','test:h5-h':'node --test tests/h5-h/*.test.mjs'},
 dependencies:{pdfkit:'0.17.2'}
};
let d;
(async()=>{try{
 d=await mkdtemp(join(tmpdir(),'crm-h5h-npm-'));
 await writeFile(join(d,'package.json'),JSON.stringify(src,null,2));
 console.log('[H5H_INSTALL] package input exact name/version/dependency verified');
 await call(['install','--package-lock-only','--ignore-scripts','--no-audit','--no-fund','--engine-strict=false'],d);
 const lock=JSON.parse(await readFile(join(d,'package-lock.json'),'utf8'));
 if(lock.name!==src.name||lock.packages[''].dependencies.pdfkit!=='0.17.2')throw Error('INVALID_GENERATED_LOCK');
 st.lockReady=true;console.log('[H5H_INSTALL] lock generated packages='+Object.keys(lock.packages).length);
 await call(['ci','--ignore-scripts','--no-audit','--no-fund','--engine-strict=false'],d);
 st.npmCi=true;console.log('[H5H_INSTALL] npm ci PASS');
 await call(['ls','pdfkit','--depth=0'],d);console.log('[H5H_INSTALL] pdfkit version PASS');
 const raw=JSON.stringify(lock,null,2)+'\n';
 // Plain-text chunks permit copying exact lock bytes into repository without external URLs.
 console.log('[H5H_LOCK_BEGIN] '+raw.length);
 for(let i=0;i<raw.length;i+=700)console.log('[H5H_LOCK_PART '+String(i/700).padStart(3,'0')+'] '+JSON.stringify(raw.slice(i,i+700)));
 console.log('[H5H_LOCK_END]');
 st.phase='PASS';console.log('[H5H_INSTALL] FINAL '+JSON.stringify(st));
}catch(e){st.phase='FAIL';st.error=e.message;console.log('[H5H_INSTALL] FINAL '+JSON.stringify(st))}
finally{if(d)await rm(d,{recursive:true,force:true}).catch(()=>{})}})();
