// H5-B isolated presentation adapter; no production routing or canonical integration.
const labels={loading:'Carregando orçamento…',saved:'Salvo',unsaved:'Alterações não salvas',saving:'Salvando…',retryable_error:'Falha ao salvar. Tente novamente.',conflict:'Conflito de versão. O rascunho foi preservado.'};
export function mountDraftEditor(host,controller){
 if(!host||typeof host.replaceChildren!=='function')throw Error('HOST_REQUIRED');
 const document=host.ownerDocument;
 const container=document.createElement('section'),heading=document.createElement('h2'),status=document.createElement('p'),field=document.createElement('input'),save=document.createElement('button'),retry=document.createElement('button'),discard=document.createElement('button');
 heading.textContent='Rascunho do orçamento';field.type='text';field.setAttribute('aria-label','Nome do cliente');save.textContent='Salvar agora';retry.textContent='Tentar novamente';discard.textContent='Descartar alterações locais e carregar servidor';
 status.setAttribute('role','status');container.append(heading,field,status,save,retry,discard);host.replaceChildren(container);
 const render=()=>{const v=controller.view();status.textContent=labels[v.status]||'Estado indisponível';if(document.activeElement!==field)field.value=v.data.client||'';save.disabled=!v.pending||v.status==='saving';retry.hidden=v.status!=='retryable_error';discard.hidden=v.status!=='conflict';};
 const onEdit=()=>{void controller.edit({client:field.value}).catch(e=>{status.textContent='Não foi possível guardar as alterações locais: '+e.message;});};
 const onSave=()=>{void controller.flush();},onRetry=()=>{void controller.retry();},onDiscard=()=>{void controller.acceptServer();};
 field.addEventListener('input',onEdit);save.addEventListener('click',onSave);retry.addEventListener('click',onRetry);discard.addEventListener('click',onDiscard);
 const unsub=controller.subscribe(render);render();
 return ()=>{unsub();field.removeEventListener('input',onEdit);save.removeEventListener('click',onSave);retry.removeEventListener('click',onRetry);discard.removeEventListener('click',onDiscard);host.replaceChildren();};
}
