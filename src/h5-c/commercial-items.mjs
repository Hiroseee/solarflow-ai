// H5-C isolated commercial selection. No canonical SKU, price, or approved BESS accessory mapping.
export const KIT_CHOICES=Object.freeze([{id:'12kw',label:'Base 12 kW — trifásico 380 V',inverterKw:12},{id:'15kw',label:'Base 15 kW — trifásico 380 V',inverterKw:15}]);
export const CATEGORIES=Object.freeze(['inverter','bess','module','structure','dc_cable_black','dc_cable_red','mc4','accessory','other']);
const copy=v=>structuredClone(v);
function validateProduct(p){if(!p||typeof p.id!=='string'||!p.id.trim()||!CATEGORIES.includes(p.category)||typeof p.label!=='string'||!p.label.trim())throw Error('INVALID_CATALOG_PRODUCT');return p;}
export function makeCatalog(products=[]){const map=new Map();for(const p of products){validateProduct(p);if(map.has(p.id))throw Error('DUPLICATE_CATALOG_ID');map.set(p.id,copy(p));}return map;}
export function chooseKit(draft,kitId){if(!KIT_CHOICES.some(k=>k.id===kitId))throw Error('INVALID_KIT_CHOICE');return {...copy(draft),kitChoice:kitId,items:copy(draft.items||[])};}
export function validateItems(items,catalog){if(!Array.isArray(items)||items.length>300)throw Error('INVALID_ITEMS');const ids=new Set();for(const it of items){if(!it||typeof it.lineId!=='string'||!it.lineId||ids.has(it.lineId))throw Error('DUPLICATE_LINE_ID');ids.add(it.lineId);const p=catalog.get(it.productId);if(!p)throw Error('UNKNOWN_PRODUCT');if(!Number.isSafeInteger(it.quantity)||it.quantity<=0||it.quantity>100000)throw Error('INVALID_QUANTITY');if(it.category!==p.category)throw Error('CATEGORY_MISMATCH');if(it.kitChoice&&!KIT_CHOICES.some(k=>k.id===it.kitChoice))throw Error('INVALID_KIT_LINK');if(it.category==='accessory'&&it.relatedBessLineId&&!items.some(x=>x.lineId===it.relatedBessLineId&&x.category==='bess'))throw Error('ORPHAN_ACCESSORY');}return true;}
export function addItem(draft,catalog,{productId,quantity=1,lineId,relatedBessLineId=null}){
 const items=copy(draft.items||[]),p=catalog.get(productId);if(!p)throw Error('UNKNOWN_PRODUCT');
 if(!lineId||typeof lineId!=='string'||items.some(i=>i.lineId===lineId))throw Error('DUPLICATE_LINE_ID');
 const item={lineId,productId,category:p.category,quantity,kitChoice:draft.kitChoice||null,relatedBessLineId};
 if(item.category==='accessory'&&relatedBessLineId&&!items.some(x=>x.lineId===relatedBessLineId&&x.category==='bess'))throw Error('ORPHAN_ACCESSORY');
 items.push(item);validateItems(items,catalog);return {...copy(draft),items};
}
export function setQuantity(draft,catalog,lineId,quantity){const items=copy(draft.items||[]),item=items.find(i=>i.lineId===lineId);if(!item)throw Error('ITEM_NOT_FOUND');item.quantity=quantity;validateItems(items,catalog);return {...copy(draft),items};}
export function removeItem(draft,catalog,lineId){const items=copy(draft.items||[]);if(!items.some(i=>i.lineId===lineId))throw Error('ITEM_NOT_FOUND');
 // Prevent silently orphaning accessories when a BESS line is removed.
 if(items.some(i=>i.relatedBessLineId===lineId))throw Error('BESS_HAS_ASSOCIATED_ACCESSORIES');
 const next=items.filter(i=>i.lineId!==lineId);validateItems(next,catalog);return {...copy(draft),items:next};}
export function kitAlerts(draft,catalog){const items=draft.items||[];validateItems(items,catalog);
 const out=[];if(!draft.kitChoice)out.push('KIT_NOT_SELECTED');
 const has=category=>items.some(i=>i.category===category);
 for(const category of ['inverter','bess','module','dc_cable_black','mc4'])if(!has(category))out.push('MISSING_'+category.toUpperCase());
 for(const i of items)if(i.category==='accessory'&&!i.relatedBessLineId)out.push('ACCESSORY_LINK_NOT_CONFIRMED:'+i.lineId);
 // Do not invent product-level mandatory dependencies not provided in spec/catalog.
 return out;
}
export function catalogView(catalog){return [...catalog.values()].map(p=>({id:p.id,category:p.category,label:p.label,available:p.available!==false}));}
