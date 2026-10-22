import {spawn} from 'node:child_process';import {createServer} from 'node:http';
const state={phase:'RUNNING',suite:'H5_B_DEMO_SHORT_REGRESSION',exitCode:null,error:null};
createServer((_q,r)=>{r.setHeader('content-type','application/json');r.end(JSON.stringify(state))}).listen(Number(process.env.PORT||10000),'0.0.0.0');
const child=spawn(process.execPath,['--test','../tests/h5-b/demo-contract.test.mjs','../tests/h5-b/browser-store.test.mjs','../tests/h5-b/draft-editor.test.mjs'],{stdio:['ignore','pipe','pipe']});
for(const stream of [child.stdout,child.stderr])stream.on('data',buf=>{for(const line of buf.toString().split('\n').filter(Boolean))console.log('[H5B_DEMO]',line)});
child.on('error',e=>{state.phase='FAIL';state.error=e.message;console.log('[H5B_DEMO] ERROR',e.message)});
child.on('close',code=>{state.exitCode=code;state.phase=code===0?'PASS':'FAIL';console.log('[H5B_DEMO] FINAL',JSON.stringify(state))});
