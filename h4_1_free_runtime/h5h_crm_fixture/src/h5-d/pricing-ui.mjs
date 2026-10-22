import {calculateDraft,moneyBRL} from './pricing-engine.mjs';
export function mountPricingPanel(host,controller,catalog,{discountPolicy=null}={}){
 const d=host.ownerDocument,section=d.createElement('section'),priceContainer=d.createElement('div'),freight=d.createElement('input'),mode=d.createElement('select'),total=d.createElement('p'),status=d.createElement('p');
 for(const [value,label] of [['FOB','FOB — sem frete'],['CIF','CIF — frete manual fictício']]){const o=d.createElement('option');o.value=value;o.textContent=label;mode.append(o)}
 freight.type='number';freight.min='0';freight.step='0.01';freight.setAttribute('aria-label','Frete fictício em reais');status.setAttribute('role','status');total.setAttribute('aria-live','polite');
 const field=(label,node)=>{const wrap=d.createElement('label');wrap.textContent=label;wrap.append(node);return wrap;};section.append(priceContainer,field('Modalidade de frete ',mode),field('Frete fictício (R$) ',freight),total,status);host.replaceChildren(section);
 const parse=v=>{if(!/^\d+(?:\.\d{1,2})?$/.test(v))throw Error('VALOR_INVALIDO');const [whole,fraction='']=v.split('.');const cents=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));if(cents>BigInt(Number.MAX_SAFE_INTEGER))throw Error('VALOR_INVALIDO');return Number(cents)};
 let dirtyFreight=false;
 const render=()=>{const v=controller.view(),p=v.data.pricing||{unitPrices:{},freight:{incoterm:'FOB',mode:'none'}};priceContainer.replaceChildren();
 for(const item of v.data.items||[]){const row=d.createElement('div'),label=d.createElement('span'),input=d.createElement('input');label.textContent=(catalog.get(item.productId)?.label||item.productId)+' × '+item.quantity+' — preço unitário fictício R$ ';input.type='number';input.min='0';input.step='0.01';input.value=p.unitPrices?.[item.productId]===undefined?'':(p.unitPrices[item.productId]/100).toFixed(2);input.setAttribute('aria-label','Preço fictício '+item.lineId);input.onchange=()=>{try{const newPricing={...p,unitPrices:{...p.unitPrices,[item.productId]:parse(input.value)}};void controller.edit({pricing:newPricing}).catch(e=>status.textContent=e.message);}catch(e){status.textContent=e.message}};row.append(label,input);priceContainer.append(row);}
 mode.value=p.freight?.incoterm||'FOB';freight.disabled=mode.value==='FOB';if(!dirtyFreight)freight.value=((p.freight?.cents||0)/100).toFixed(2);
 try{const summary=calculateDraft(v.data,catalog,p,{discountPolicy});total.textContent='Subtotal: '+moneyBRL(summary.subtotalCents)+' | Frete: '+moneyBRL(summary.freightCents)+' | Total: '+moneyBRL(summary.totalCents);status.textContent='Salvamento: '+v.status+' · Valores apenas de teste';}
 catch(e){total.textContent='Preencha os preços unitários fictícios para calcular';status.textContent=e.message+' · Salvamento: '+v.status;}
 };
 mode.onchange=()=>{const p=controller.view().data.pricing||{unitPrices:{}};const next={...p,freight:mode.value==='FOB'?{incoterm:'FOB',mode:'none'}:{incoterm:'CIF',mode:'manual',cents:0}};void controller.edit({pricing:next});};
 freight.onchange=()=>{try{const p=controller.view().data.pricing||{unitPrices:{}};dirtyFreight=false;void controller.edit({pricing:{...p,freight:{incoterm:'CIF',mode:'manual',cents:parse(freight.value)}}})}catch(e){status.textContent=e.message}};
 freight.oninput=()=>{dirtyFreight=true};
 const unsub=controller.subscribe(render);render();return ()=>{unsub();host.replaceChildren()};
}
