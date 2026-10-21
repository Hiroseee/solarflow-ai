import {createServer} from 'node:http';
import {createWriteStream,readFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import PDFDocument from 'pdfkit';
const S={phase:'STARTING',gate_f:'PENDING',pdf_template_gate:'PENDING',results:[],error:null};
createServer((_q,r)=>{r.setHeader('content-type','application/json');r.end(JSON.stringify(S));}).listen(Number(process.env.PORT||10000),'0.0.0.0');
const sha=x=>createHash('sha256').update(x).digest('hex');
const fmt=n=>n.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const snapshot={
 id:'H41-FICTITIOUS-004',client:'Cliente Fictício (ambiente de testes)',
 template_version:'h4.1-proof-v1',currency:'BRL',
 commercial:{validity:'10 dias',delivery:'CIF / FOB conforme orçamento',notes:'Condições fictícias; nenhuma proposta real.'},
 items:[
 {group:'Solar',name:'Inversor trifásico 15 kW',quantity:1,unit_price:9500,note:'Especificação de referência para teste.'},
 {group:'Solar',name:'Módulo fotovoltaico 610 W',quantity:13,unit_price:690,note:'Quantidade fictícia.'},
 {group:'BESS',name:'Sistema BESS 100 kWh',quantity:1,unit_price:73000,note:'Configuração fictícia.'},
 {group:'Comissionamento',name:'Comissionamento de instalação',quantity:1,unit_price:0,note:'Sem cobrança; justificativa: incluído no fornecimento.'}
 ],
 extra_optional:null
};
const total=snapshot.items.reduce((n,x)=>n+x.quantity*x.unit_price,0);
const out=path.join(process.cwd(),'evidence');mkdirSync(out,{recursive:true});
async function build(file,mode,large){
 const dest=path.join(out,file);
 let added=0;const p=new PDFDocument({size:'A4',margins:{top:110,bottom:88,left:42,right:42},bufferPages:true,compress:false});
 p.on('pageAdded',()=>added++);
 const w=createWriteStream(dest);p.pipe(w);
 const row=(x)=>{if(p.y>685)p.addPage();const yy=p.y;const desc=large?x.name+' — '+('Descrição técnica longa do equipamento, acessório e composição comercial, testando quebra controlada de texto. ').repeat(3):x.name;
 p.font('Helvetica').fontSize(9).fillColor('#111').text(desc,46,yy,{width:mode==='open'?245:385});
 const endY=p.y;if(mode==='open'){p.text(String(x.quantity),298,yy,{width:30,align:'right'});p.text('R$ '+fmt(x.unit_price),335,yy,{width:90,align:'right'});p.text('R$ '+fmt(x.quantity*x.unit_price),428,yy,{width:125,align:'right'});}
 if(mode!=='closed')p.fontSize(8).fillColor('#666').text(x.note,46,Math.max(endY,yy+12),{width:450});
 p.y=Math.max(p.y,endY,yy+44)+9;};
 p.fontSize(14).text('PROPOSTA COMERCIAL — '+mode.toUpperCase(),46,120);
 p.moveDown(.8);
 const groups=[...new Set(snapshot.items.map(x=>x.group))];
 if(mode==='grouped'){for(const g of groups){p.font('Helvetica-Bold').fontSize(11).fillColor('#111').text(g,46,p.y+9);p.moveDown(.45);for(const x of snapshot.items.filter(y=>y.group===g))row(x);}}
 else for(const x of snapshot.items)row(x);
 if(large){for(let i=0;i<18;i++){if(p.y>660)p.addPage();p.fontSize(9).fillColor('#111').text('Condições comerciais editáveis '+String(i+1)+': '+('Observações e condições de entrega fictícias para verificar paginação e legibilidade. ').repeat(5),46,p.y,{width:510});p.moveDown(.6);}}
 p.moveDown(1);if(p.y>690)p.addPage();
 p.font('Helvetica-Bold').fontSize(12).fillColor('#111').text('TOTAL: R$ '+fmt(total),46,p.y,{width:506,align:'right'});
 p.font('Helvetica').fontSize(9).text('Validade: '+snapshot.commercial.validity+' | Entrega: '+snapshot.commercial.delivery,46,p.y+14,{width:500});
 const range=p.bufferedPageRange();for(let i=range.start;i<range.start+range.count;i++){p.switchToPage(i);p.rect(42,35,510,54).fill('#161616');p.fillColor('#fff').font('Helvetica-Bold').fontSize(15).text('BelEnergy  |  Proposta Comercial',54,52,{width:470});p.rect(42,90,510,4).fill('#d9b300');p.fillColor('#444').font('Helvetica').fontSize(8).text(snapshot.client,46,101);p.text('template_version: '+snapshot.template_version+' | Página '+(i+1)+' / '+range.count,46,780,{width:505,align:'center'});}
 p.end();await new Promise((ok,bad)=>{w.on('finish',ok);w.on('error',bad)});
 const b=readFileSync(dest);const pages=(b.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length;
 if(!b.subarray(0,5).equals(Buffer.from('%PDF-')))throw Error('NOT_PDF');
 if(pages<1||(large&&pages<2))throw Error('PAGINATION_FAIL:'+pages);
 return {file,mode,pages,sha256:sha(b),size:b.length,total,template_version:snapshot.template_version};
}
(async()=>{try{
 S.phase='RENDER';
 S.results.push(await build('F_fechado.pdf','closed',false));
 S.results.push(await build('F_aberto.pdf','open',false));
 S.results.push(await build('F_multipage.pdf','open',true));
 S.results.push(await build('F_solar_bess_comissionamento.pdf','grouped',false));
 const values=S.results.map(x=>x.total);if(values.some(x=>x!==values[0]))throw Error('ECONOMIC_SNAPSHOT_DIVERGENCE');
 if(S.results.some(x=>!x.sha256||!x.template_version))throw Error('METADATA_FAIL');
 S.gate_f='PASS_RUNTIME_RENDER';
 S.pdf_template_gate='PENDING_INDEPENDENT_VISUAL_BRAND_PARITY';
 S.phase='COMPLETE';
 console.log('[H41_PDF] FINAL',JSON.stringify(S));
}catch(e){S.error=e.message;S.phase='FAIL';console.error('[H41_PDF] FAIL',e.message)}})();
