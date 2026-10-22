import {createRequire} from 'node:module';
const localRequire=createRequire(new URL('../../h4_1_free_runtime/package.json',import.meta.url));
const PDFDocument=localRequire('pdfkit');
import {verifyFixtureSnapshot} from './fixture-snapshot.mjs';
import {moneyBRL} from '../h5-d/pricing-engine.mjs';
export async function renderFixturePdf(snapshot){
 verifyFixtureSnapshot(snapshot);
 const doc=new PDFDocument({size:'A4',margin:45,compress:false,info:{Title:'DOCUMENTO DE TESTE — SEM VALIDADE COMERCIAL',Author:'H5-F fixture',CreationDate:new Date('2000-01-01T00:00:00Z')}});
 const chunks=[];doc.on('data',c=>chunks.push(c));
 const end=new Promise((resolve,reject)=>{doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject)});
 const width=505;const footer=()=>{doc.fontSize(8).fillColor('#b3261e').text('DOCUMENTO DE TESTE — SEM VALIDADE COMERCIAL',45,778,{width,align:'center'});};
 const newPage=()=>{footer();doc.addPage();doc.y=45;doc.fontSize(9).fillColor('#19314f').text('PRÉVIA DE PROPOSTA — TESTE',45,43,{width});doc.y=75;};
 doc.fillColor('#19314f').fontSize(18).text('Prévia de proposta comercial');
 doc.moveDown(.3).fillColor('#b3261e').fontSize(11).text('DOCUMENTO DE TESTE — SEM VALIDADE COMERCIAL');
 doc.moveDown(.6).fillColor('#273447').fontSize(10);
 const p=snapshot.preview;
 const safe=v=>String(v??'Pendente').slice(0,350);
 for(const [k,v] of [['Identificação',p.identity.proposalId],['Cliente',p.identity.client],['Oportunidade',p.identity.opportunityId],['Kit',p.identity.kitChoice],['Revisão fictícia',snapshot.revisionLabel],['Data da fixture',snapshot.eventAt],['Versão do rascunho',snapshot.version]])doc.text(k+': '+safe(v),{width});
 doc.moveDown();doc.fontSize(12).fillColor('#19314f').text('Composição');doc.moveDown(.4);
 for(const [category,items] of Object.entries(p.groups)){
 if(doc.y>700)newPage();
 doc.fontSize(10).fillColor('#19314f').text(category.toUpperCase(),{width});doc.moveDown(.2);
 for(const item of items){if(doc.y>713)newPage();const desc=safe(item.description);const amount=item.subtotalCents==null?'Pendente':moneyBRL(item.subtotalCents);
 doc.fontSize(9).fillColor('#273447').text(desc,{width:280,continued:false});doc.fontSize(9).text('Quantidade: '+item.quantity+'  |  Subtotal: '+amount,{width});doc.moveDown(.25);}
 }
 if(doc.y>650)newPage();doc.moveDown();doc.fontSize(12).fillColor('#19314f').text('Resumo financeiro');doc.fontSize(10).fillColor('#273447');
 if(p.financial){for(const [key,value] of [['Subtotal',p.financial.subtotalCents],['Desconto',p.financial.discountCents],['Frete',p.financial.freightCents]])doc.text(key+': '+moneyBRL(value),{width});
 doc.moveDown(.4);doc.fontSize(15).fillColor('#19314f').text('TOTAL: '+moneyBRL(p.financial.totalCents),{width});}
 else doc.text('Valores não validados', {width});
 footer();doc.end();return end;
}
