// H5-H ONLY: isolated fixture integration test entrypoint for existing Render FREE service.
// Never configures production, canonical migrations, real customer data, or Storage.
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
const state={phase:'STARTING',isolation:'LOCAL_FIXTURE_NO_AUTH',tests:0,pass:0,fail:0,error:null};
createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(state))})
 .listen(Number(process.env.PORT||10000),'0.0.0.0');
const child=spawn(process.execPath,['--test','h5h_crm_fixture/tests/h5-h/integrated-flow.test.mjs'],{
 cwd:new URL('.',import.meta.url).pathname,env:process.env,stdio:['ignore','pipe','pipe']
});
let result='';
for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{
 const chunk=data.toString();result+=chunk;for(const line of chunk.split('\n'))if(line.trim())console.log('[H5H_TEST] '+line.trim());
});
child.on('error',error=>{state.phase='FAIL';state.error=error.message;console.log('[H5H_TEST] FINAL '+JSON.stringify(state))});
child.on('exit',(code)=>{
 state.tests=Number(result.match(/^# tests (\d+)/m)?.[1]||0);
 state.pass=Number(result.match(/^# pass (\d+)/m)?.[1]||0);
 state.fail=Number(result.match(/^# fail (\d+)/m)?.[1]||0);
 state.phase=code===0&&state.tests>=12&&state.pass===state.tests&&state.fail===0?'PASS':'FAIL';
 if(state.phase==='FAIL')state.error='TEST_RUN_EXIT_'+code;
 console.log('[H5H_TEST] FINAL '+JSON.stringify(state));
});
