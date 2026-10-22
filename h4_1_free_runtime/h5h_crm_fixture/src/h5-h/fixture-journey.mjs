// One composition path for the existing H5-B/C/D/E/F engines; not a new calculator or PDF renderer.
// Server-side demo fixture ONLY. Financial fields are never sent to authenticated H5-G write RPCs.
import {createHash} from 'node:crypto';
import {validateItems} from '../h5-c/commercial-items.mjs';
import {calculateDraft} from '../h5-d/pricing-engine.mjs';
import {snapshotFixture,blockOfficialIssuance} from '../h5-f/fixture-snapshot.mjs';
import {renderFixturePdf} from '../h5-f/fixture-pdfkit.mjs';
import {PrivateFixtureStore,FixtureRevisionLedger} from '../h5-f/fixture-revisions.mjs';
import {fictionalCatalog} from './fictional-catalog.mjs';
const allowed=(object,keys)=>object&&typeof object==='object'&&!Array.isArray(object)&&Object.keys(object).every(x=>keys.includes(x));
const safeId=x=>typeof x==='string'&&/^[a-z0-9_-]{1,100}$/i.test(x);
const readonly=v=>structuredClone(v);
export class IntegratedFixtureJourney{
 constructor({ownerId='fixture_local'}={}){
  if(!safeId(ownerId))throw Error('INVALID_FIXTURE_OWNER');
  this.ownerId=ownerId;
  this.store=new PrivateFixtureStore();
  this.ledger=new FixtureRevisionLedger();
 }
 validate({budgetId,revisionId,mutationId,version,draft}){
  if(!allowed(arguments[0],['budgetId','revisionId','mutationId','version','draft']))throw Error('INVALID_FIXTURE_ENVELOPE');
  if(!safeId(budgetId)||!safeId(revisionId)||!safeId(mutationId)||
   !Number.isSafeInteger(version)||version<1)throw Error('INVALID_FIXTURE_IDENTITY');
  if(!allowed(draft,['client','kitChoice','items','pricing']))
   throw Error('INVALID_FIXTURE_ROOT');
  if(typeof draft.client!=='string'||!draft.client.trim()||draft.client.length>256)
   throw Error('INVALID_FIXTURE_CLIENT');
  if(!['12kw','15kw'].includes(draft.kitChoice))throw Error('INVALID_FIXTURE_KIT');
  validateItems(draft.items,fictionalCatalog);
  for(const line of draft.items){
   if(!allowed(line,['lineId','productId','category','quantity','kitChoice','relatedBessLineId']))
    throw Error('INVALID_FIXTURE_LINE_FIELDS');
   const p=fictionalCatalog.get(line.productId);
   if(p?.available===false)throw Error('UNAVAILABLE_FIXTURE_ITEM');
   if(line.category==='accessory' && !line.relatedBessLineId)throw Error('MISSING_BESS_ASSOCIATION');
  }
  if(!allowed(draft.pricing,['unitPrices','freight','discount']))throw Error('INVALID_FIXTURE_PRICING');
  if(draft.pricing.discount && draft.pricing.discount.mode!=='none')
   throw Error('UNAPPROVED_DISCOUNT_DENIED');
  if(!allowed(draft.pricing.unitPrices,Array.from(fictionalCatalog.keys())))throw Error('UNKNOWN_FIXTURE_PRICE');
  if(!allowed(draft.pricing.freight,['incoterm','mode','cents']))throw Error('INVALID_FIXTURE_FREIGHT');
  const computed=calculateDraft(draft,fictionalCatalog,draft.pricing);
  if(!computed.lines.length)throw Error('EMPTY_FIXTURE');
  return computed;
 }
 async record(payload){
  const numbers=this.validate(payload);
  const {budgetId,revisionId,mutationId,version,draft}=payload;
  const snapshot=snapshotFixture({budgetId,revisionId,mutationId,revisionLabel:'Revisão fictícia '+revisionId,
   eventAt:'2000-01-01T00:00:00.000Z',version,draft,catalog:fictionalCatalog});
  const pdf=await renderFixturePdf(snapshot);
  const row=await this.ledger.record({budgetId,revisionId,mutationId,ownerId:this.ownerId,snapshot,pdf,store:this.store});
  return {budgetId,revisionId,mutationId,version,state:row.state,
   pdfSha256:row.pdfSha256,snapshotSha256:snapshot.integritySha256,totalCents:numbers.totalCents,
   fileUrl:'/api/fixture-revisions/'+encodeURIComponent(budgetId)+'/'+encodeURIComponent(revisionId)+'/pdf'};
 }
 list(budgetId){
  if(!safeId(budgetId))throw Error('INVALID_FIXTURE_BUDGET');
  return this.ledger.list(budgetId,{ownerId:this.ownerId}).map(r=>({
   budgetId:r.budgetId,revisionId:r.revisionId,version:r.snapshot.version,
   state:r.state,pdfSha256:r.pdfSha256,totalCents:r.snapshot.preview.financial.totalCents,
   fileUrl:'/api/fixture-revisions/'+encodeURIComponent(r.budgetId)+'/'+encodeURIComponent(r.revisionId)+'/pdf'
  }));
 }
 async pdf(budgetId,revisionId){
  if(!safeId(budgetId)||!safeId(revisionId))throw Error('INVALID_FIXTURE_IDENTITY');
  const row=this.ledger.get(budgetId,revisionId,{ownerId:this.ownerId});
  const bytes=await this.store.get(row.path,{ownerId:this.ownerId});
  if(createHash('sha256').update(bytes).digest('hex')!==row.pdfSha256)throw Error('FIXTURE_PDF_HASH_MISMATCH');
  return bytes;
 }
 officialIssuance(){blockOfficialIssuance();}
}
