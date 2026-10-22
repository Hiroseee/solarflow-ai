import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const ui=readFileSync(new URL('../../src/h5-e/proposal-preview-ui.mjs',import.meta.url),'utf8');
const demo=readFileSync(new URL('../../demo/h5-e.html',import.meta.url),'utf8');
test('proposal UI uses safe DOM text nodes, no dynamic HTML',()=>{assert.match(ui,/textContent/);assert.doesNotMatch(ui,/innerHTML|insertAdjacentHTML|eval\s*\(/);});
test('demo uses H5-C assembly, H5-D pricing, H5-B controller and same preview controller',()=>{for(const s of ['mountCommercialItems','mountPricingPanel','mountProposalPreview','new DraftController'])assert.ok(demo.includes(s));assert.match(demo,/cleanupPreview=mountProposalPreview/);});
test('preview offers return to editing and has no issuing action',()=>{assert.match(ui,/Voltar à edição/);assert.match(demo,/setPreview\(false\)/);assert.doesNotMatch(demo,/uploadToStorage|issueProposal|emitirPDF|supabase\.co|service_role/);});
test('demo discloses fictional storage and item data',()=>{assert.match(demo,/localStorage/);assert.match(demo,/fictícios|fictício/);});
