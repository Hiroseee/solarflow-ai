import {spawn} from 'node:child_process';import {createServer} from 'node:http';
const state={phase:'RUNNING',suite:'H5_B_ISOLATED_UNIT',exitCode:null,checks:[],error:null};
createServer((_req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(state))}).listen(Number(process.env.PORT||10000),'0.0.0.0');
const child=spawn(process.execPath,['--test','../tests/h5-b/draft-engine.test.mjs'],{stdio:['ignore','pipe','pipe']});
for(const stream of [child.stdout,child.stderr])stream.on('data',buf=>{for(const line of buf.toString().split('\n').filter(Boolean)){console.log('[H5B_TEST]',line);if(/^(ok|not ok) /.test(line))state.checks.push(line);}});
child.on('error',e=>{state.phase='FAIL';state.error=e.message;console.error('[H5B_TEST] FAIL',e.message)});
child.on('close',code=>{state.exitCode=code;state.phase=code===0?'PASS':'FAIL';console.log('[H5B_TEST] FINAL',JSON.stringify(state));});
