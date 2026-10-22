import {KIT_CHOICES,catalogView,chooseKit,addItem,setQuantity,removeItem,kitAlerts} from './commercial-items.mjs';
export function mountCommercialItems(host,controller,catalog){
 const doc=host.ownerDocument,section=doc.createElement('section'),kit=doc.createElement('select'),product=doc.createElement('select'),qty=doc.createElement('input'),add=doc.createElement('button'),list=doc.createElement('div'),warnings=doc.createElement('p'),status=doc.createElement('p');
 const label=(text,control)=>{const l=doc.createElement('label');l.textContent=text;l.append(control);return l;};
 for(const k of [{id:'',label:'Escolha um kit'},...KIT_CHOICES]){const o=doc.createElement('option');o.value=k.id;o.textContent=k.label;kit.append(o);}
 const products=catalogView(catalog);for(const p of [{id:'',label:'Selecione produto fictício'},...products]){const o=doc.createElement('option');o.value=p.id;o.textContent=p.label+(p.available===false?' — indisponível':'');o.disabled=p.available===false;product.append(o);}
 qty.type='number';qty.min='1';qty.max='100000';qty.step='1';qty.value='1';add.type='button';add.textContent='Adicionar item';warnings.setAttribute('role','status');status.setAttribute('aria-live','polite');
 section.append(label('Kit base ',kit),label('Produto ',product),label('Quantidade ',qty),add,list,warnings,status);host.replaceChildren(section);
 const render=()=>{const v=controller.view(),data=v.data;kit.value=data.kitChoice||'';list.replaceChildren();
  for(const it of data.items||[]){const p=catalog.get(it.productId),r=doc.createElement('div'),name=doc.createElement('span'),count=doc.createElement('input'),remove=doc.createElement('button');
   name.textContent=(p?.label||'[Item indisponível]')+' ('+it.lineId+') ';count.type='number';count.min='1';count.max='100000';count.value=String(it.quantity);count.setAttribute('aria-label','Quantidade '+(p?.label||it.lineId));
   count.onchange=()=>{try{void controller.edit(setQuantity(controller.view().data,catalog,it.lineId,Number(count.value))).catch(show)}catch(e){show(e)}};
   remove.textContent='Remover';remove.onclick=()=>{try{void controller.edit(removeItem(controller.view().data,catalog,it.lineId)).catch(show)}catch(e){show(e)}};
   r.append(name,count,remove);list.append(r);
  }
  try{warnings.textContent='Avisos de composição: '+(kitAlerts(data,catalog).join(', ')||'nenhum');}catch(e){warnings.textContent='Itens inválidos: '+e.message;}
  status.textContent='Estado de salvamento: '+v.status;
 };
 const show=e=>{status.textContent='Erro: '+e.message;};
 kit.onchange=()=>{try{void controller.edit(chooseKit(controller.view().data,kit.value)).catch(show)}catch(e){show(e)}};
 add.onclick=()=>{try{const p=catalog.get(product.value);if(!p||p.available===false)throw Error('ITEM_INDISPONIVEL');void controller.edit(addItem(controller.view().data,catalog,{productId:p.id,quantity:Number(qty.value),lineId:crypto.randomUUID()})).catch(show);}catch(e){show(e)}};
 const unsub=controller.subscribe(render);render();return ()=>{unsub();host.replaceChildren();};
}
