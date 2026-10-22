import {composeProposal,moneyBRL} from './proposal-preview.mjs';
const fmt=v=>v===null?'Pendente':moneyBRL(v);
export function mountProposalPreview(host,controller,catalog,options={}){
 const doc=host.ownerDocument;const section=doc.createElement('section'),title=doc.createElement('h2'),meta=doc.createElement('p'),groups=doc.createElement('div'),total=doc.createElement('p'),warnings=doc.createElement('ul'),status=doc.createElement('p'),back=doc.createElement('button');
 title.textContent='Prévia da proposta — não emitida';back.textContent='Voltar à edição';back.type='button';status.setAttribute('role','status');total.setAttribute('aria-live','polite');warnings.setAttribute('aria-label','Pendências');
 section.append(title,meta,groups,total,status,warnings,back);host.replaceChildren(section);
 let last=null;
 const render=()=>{const view=controller.view();last=composeProposal(view.data,catalog,{...options,saveStatus:view.status,version:view.version});const p=last;
 meta.textContent='Cliente: '+(p.identity.client||'Pendente')+' | Oportunidade: '+(p.identity.opportunityId||'Pendente')+' | Kit: '+(p.identity.kitChoice||'Pendente')+' | Versão: '+(p.identity.version??'Pendente');
 groups.replaceChildren();for(const [category,items] of Object.entries(p.groups)){const h=doc.createElement('h3');h.textContent=category;groups.append(h);for(const item of items){const row=doc.createElement('p');row.textContent=item.description+' × '+item.quantity+' | Unitário: '+fmt(item.unitCents)+' | Subtotal: '+fmt(item.subtotalCents);groups.append(row)}}
 total.textContent=p.financial?'Subtotal '+moneyBRL(p.financial.subtotalCents)+' | Desconto '+moneyBRL(p.financial.discountCents)+' | Frete '+moneyBRL(p.financial.freightCents)+' | Total '+moneyBRL(p.financial.totalCents):'Totais pendentes de preços válidos';
 status.textContent='Salvamento: '+view.status+' | Prévia disponível | Emissão não autorizada';
 warnings.replaceChildren();for(const issue of p.validation.issues){const li=doc.createElement('li');li.textContent=issue;warnings.append(li)}
 };
 back.onclick=()=>{if(typeof options.onBack==='function')options.onBack()};const unsub=controller.subscribe(render);render();
 return {render,projection:()=>last,dispose:()=>{unsub();back.onclick=null;host.replaceChildren()}};
}
