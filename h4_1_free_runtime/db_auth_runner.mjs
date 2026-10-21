import {execFile} from 'node:child_process';
import {createServer} from 'node:http';
const state={phase:'starting',cliVersion:null,help:null,error:null};
createServer((_q,r)=>{r.setHeader('content-type','application/json');r.end(JSON.stringify(state));}).listen(Number(process.env.PORT||10000),'0.0.0.0');
for (const args of [['--version'],['start','--help']]) {
 state.phase=args.join(' ');
 await new Promise(resolve=>execFile('npx',['--no-install','supabase',...args],{timeout:45000,maxBuffer:1000000},(e,out,err)=>{if(e){state.error={step:args.join(' '),message:e.message,stderr:(err||'').slice(-2000)};}else if(args[0]==='--version'){state.cliVersion=out.trim();}else{state.help=out.slice(0,16000);}console.log('[CLI_PROBE_JSON]',JSON.stringify({args,status:e?'FAIL':'PASS',output:(out||err).slice(0,12000)}));resolve();}));
 if(state.error)break;
}
state.phase=state.error?'FAIL':'PASS';
