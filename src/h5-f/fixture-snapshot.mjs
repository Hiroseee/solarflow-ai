import {createHash} from 'node:crypto';
import {composeProposal} from '../h5-e/proposal-preview.mjs';
const clone=x=>structuredClone(x);
export function snapshotFixture({budgetId,revisionId,revisionLabel,draft,catalog,version,eventAt,mutationId,discountPolicy=null}){
 if(!budgetId||!revisionId||!mutationId||!Number.isSafeInteger(version)||version<1)throw Error('INVALID_SNAPSHOT_IDENTITY');
 const preview=composeProposal(draft,catalog,{version,saveStatus:'saved',discountPolicy});
 if(!preview.financial)throw Error('PRICING_NOT_VALIDATED');
 // No official issuance, even with full fictional fields.
 const immutablePayload={mode:'PREVIEW_PDF_FIXTURE',budgetId,revisionId,revisionLabel:revisionLabel||'Revisão de teste',version,eventAt,mutationId,preview:clone(preview)};
 const canonical=JSON.stringify(immutablePayload);
 const hash=createHash('sha256').update(canonical).digest('hex');
 return Object.freeze({...clone(immutablePayload),integritySha256:hash});
}
export function verifyFixtureSnapshot(snapshot){
 if(snapshot?.mode!=='PREVIEW_PDF_FIXTURE'||!snapshot.integritySha256)throw Error('NOT_A_FIXTURE_SNAPSHOT');
 const {integritySha256,...payload}=snapshot;const actual=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
 if(actual!==integritySha256)throw Error('SNAPSHOT_INTEGRITY_MISMATCH');return true;
}
export function blockOfficialIssuance(){throw Error('OFFICIAL_ISSUANCE_BLOCKED_PENDING_H5_A_AND_COMMERCIAL_GATES');}
