import {spawn} from 'node:child_process';import {createServer} from 'node:http';
const state={phase:'RUNNING',suite:'H5_C_CATALOG_SHORT_REGRESSION',exitCode:null};
createServer((_q,r)=>{r.setHeader('content-type','application/json');r.end(JSON.stringify(state))}).listen(Number(process.env.PORT||10000),'0.0.0.0');
const proc=spawn(process.execPath,['--test','../tests/h5-c/commercial-items.test.mjs','../tests/h5-c/commercial-items-ui-contract.test.mjs'],{stdio:['ignore','pipe','pipe']});
for(const stream of [proc.stdout,proc.stderr])stream.on('data',b=>{for(const line of b.toString().split('\n').filter(Boolean))console.log('[H5C_REGRESSION]',line)});
proc.on('close',code=>{state.phase=code===0?'PASS':'FAIL';state.exitCode=code;console.log('[H5C_REGRESSION] FINAL',JSON.stringify(state))});