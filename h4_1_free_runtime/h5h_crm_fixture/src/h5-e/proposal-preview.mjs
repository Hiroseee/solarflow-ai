import {calculateDraft,moneyBRL} from '../h5-d/pricing-engine.mjs';
import {kitAlerts,validateItems} from '../h5-c/commercial-items.mjs';
// Pure, deterministic H5-E proposal projection. Emission is always disabled in this phase.
export function composeProposal(draft,catalog,{discountPolicy=null,saveStatus='unsaved',version=null}={}){
 const issues=[];let figures=null;let items=[];
 if(!draft||typeof draft!=='object')throw Error('INVALID_DRAFT');
 try{validateItems(draft.items||[],catalog);items=(draft.items||[]).map(line=>{const p=catalog.get(line.productId);return {lineId:line.lineId,category:line.category,productId:line.productId,description:p?.label||'Item sem referência',referenceCode:p?.referenceCode||null,quantity:line.quantity,relatedBessLineId:line.relatedBessLineId||null}});}catch(e){issues.push('INVALID_ITEMS:'+e.message);}
 if(items.length){try{figures=calculateDraft(draft,catalog,draft.pricing||{unitPrices:{}},{discountPolicy});}catch(e){issues.push('PRICING_UNVERIFIED:'+e.message);}}
 else issues.push('NO_VALID_ITEMS');
 if(items.length){try{issues.push(...kitAlerts(draft,catalog));}catch(e){issues.push('KIT_VALIDATION_FAILED');}}
 if(!draft.kitChoice)issues.push('KIT_NOT_SELECTED');
 if(!draft.client||typeof draft.client!=='string'||!draft.client.trim())issues.push('CLIENT_NOT_PROVIDED');
 if(!draft.opportunityId)issues.push('OPPORTUNITY_NOT_LINKED');
 if(!draft.approvedCommercialTerms)issues.push('COMMERCIAL_TERMS_PENDING');
 if(saveStatus!=='saved')issues.push(saveStatus==='conflict'?'UNRESOLVED_VERSION_CONFLICT':'UNSAVED_CHANGES');
 if(!Number.isSafeInteger(version)||version<1)issues.push('VERSION_NOT_CONFIRMED');
 issues.push('H5_A_CANONICAL_INTEGRATION_PENDING','H5_E_ISSUANCE_GATE_NOT_IMPLEMENTED');
 const grouped={};for(const item of items){const key=item.category;const line=figures?.lines.find(x=>x.lineId===item.lineId);(grouped[key]??=[]).push({...item,unitCents:line?.unitCents??null,subtotalCents:line?.subtotalCents??null});}
 return {identity:{proposalId:draft.proposalId||null,opportunityId:draft.opportunityId||null,client:draft.client||null,kitChoice:draft.kitChoice||null,version},groups:grouped,financial:figures?{subtotalCents:figures.subtotalCents,discountCents:figures.discountCents,freightCents:figures.freightCents,totalCents:figures.totalCents}:null,freight:draft.pricing?.freight||null,commercialTerms:draft.approvedCommercialTerms||null,validation:{previewAvailable:true,draftValid:items.length>0&&!!figures&&!issues.some(x=>x.startsWith('INVALID_ITEMS')),readyForIssuance:false,issues:[...new Set(issues)],saveStatus},currency:'BRL',renderMoney:undefined};
}
export {moneyBRL};
