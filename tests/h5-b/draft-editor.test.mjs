import test from 'node:test';import assert from 'node:assert/strict';
import {mountDraftEditor} from '../../src/h5-b/draft-editor.mjs';
import {DraftController,MemoryDraftAdapter,MemoryDurableStore} from '../../src/h5-b/draft-engine.mjs';
class El {
 constructor(doc,name){this.ownerDocument=doc;this.name=name;this.children=[];this.handlers=new Map();this._value='';this.hidden=false;this.disabled=false;}
 append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;}
 setAttribute(k,v){this[k]=v;}
 addEventListener(name,fn){this.handlers.set(name,fn);}
 removeEventListener(name){this.handlers.delete(name);}
 async fire(name){this.handlers.get(name)?.();await new Promise(r=>setImmediate(r));}
 get value(){return this._value;}set value(v){this._value=v;}
}
test('isolated editor renders and saves changes with status feedback',async()=>{
 const doc={activeElement:null,createElement(name){return new El(doc,name)}},root=new El(doc,'main');
 const adapter=new MemoryDraftAdapter();await adapter.create('ui-fixture',{client:'Original'});
 const controller=new DraftController({id:'ui-fixture',adapter,durableStore:new MemoryDurableStore(),mutationIds:()=>'ui-1'});
 await controller.initialize();const unmount=mountDraftEditor(root,controller);
 const [heading,field,status,save,retry,discard]=root.children[0].children;
 assert.equal(heading.textContent,'Rascunho do orçamento');assert.equal(field.value,'Original');assert.equal(status.textContent,'Salvo');
 assert.equal(retry.hidden,true);assert.equal(discard.hidden,true);
 field.value='Atualizado';await field.fire('input');
 assert.equal(status.textContent,'Alterações não salvas');assert.equal(save.disabled,false);
 await save.fire('click');assert.equal(status.textContent,'Salvo');
 assert.equal((await adapter.load('ui-fixture')).data.client,'Atualizado');
 unmount();assert.equal(root.children.length,0);
});
