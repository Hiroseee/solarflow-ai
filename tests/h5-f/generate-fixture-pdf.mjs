// Reproducible PDFKit H5-F sample. No canonical objects or real client data.
import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {makeCatalog,chooseKit,addItem} from '../../src/h5-c/commercial-items.mjs';
import {snapshotFixture} from '../../src/h5-f/fixture-snapshot.mjs';
import {renderFixturePdf} from '../../src/h5-f/fixture-pdfkit.mjs';
const catalog=makeCatalog([
{id:'fixture-inverter',category:'inverter',label:'Inversor TRIFASICO 12kW FICTICIO'},
{id:'fixture-module',category:'module',label:'Modulo solar de teste 600Wp'},
{id:'fixture-bess',category:'bess',label:'BESS ficticio de armazenamento'},
{id:'fixture-accessory',category:'accessory',label:'Acessorio BESS ficticio'}
]);
let draft=chooseKit({client:'CLIENTE EXCLUSIVAMENTE FICTICIO',opportunityId:'OP-TESTE-001',proposalId:'PROP-FICTICIA-001',items:[]},'12kw');
draft=addItem(draft,catalog,{productId:'fixture-inverter',lineId:'line-inverter',quantity:1});
draft=addItem(draft,catalog,{productId:'fixture-module',lineId:'line-module',quantity:10});
draft=addItem(draft,catalog,{productId:'fixture-bess',lineId:'line-bess',quantity:1});
draft=addItem(draft,catalog,{productId:'fixture-accessory',lineId:'line-accessory',quantity:2,relatedBessLineId:'line-bess'});
draft.pricing={unitPrices:{'fixture-inverter':400000,'fixture-module':100000,'fixture-bess':1200000,'fixture-accessory':20000},freight:{incoterm:'CIF',mode:'manual',cents:15000}};
const snapshot=snapshotFixture({budgetId:'budget-fixture',revisionId:'fixture-rev-001',revisionLabel:'Revisao ficticia 001',version:1,eventAt:'2026-10-22T12:00:00Z',mutationId:'sample-001',draft,catalog});
const pdf=await renderFixturePdf(snapshot),pdfHash=createHash('sha256').update(pdf).digest('hex');
if(pdf.subarray(0,5).toString()!=='%PDF-')throw Error('NOT_A_VALID_PDF_HEADER');
const pages=(pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length;
const output=process.argv[2]||'/tmp/h5f_pdfkit_example.pdf';await writeFile(output,pdf);
console.log('[H5F_SAMPLE] '+JSON.stringify({generator:'src/h5-f/fixture-pdfkit.mjs',output,sha256:pdfHash,bytes:pdf.length,pages,amountCents:snapshot.preview.financial.totalCents,fixtureOnly:true}));
if(process.env.H5F_SAMPLE_GZIP_BASE64==='1')console.log('[H5F_SAMPLE_GZIP_BASE64] '+gzipSync(pdf).toString('base64'));
