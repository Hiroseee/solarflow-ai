import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const page=readFileSync(new URL('../../demo/h5-b.html',import.meta.url),'utf8');
test('demo creates fresh fictional drafts and identifies simulated persistence',()=>{for(const id of ['new','offline','conflict','reset','app','message'])assert.match(page,new RegExp('id="'+id+'"'));assert.match(page,/localStorage, sem PostgreSQL/);});
test('demo provides handlers for failure, conflict and reset',()=>{for(const name of ["$('new').onclick","$('offline').onclick","$('conflict').onclick","$('reset').onclick"])assert.ok(page.includes(name));});
test('demo avoids production endpoints, credentials and unsafe dynamic HTML',()=>{assert.ok(!/supabase\.co|service_role|DATABASE_URL|innerHTML|dangerouslySetInnerHTML/.test(page));assert.ok(page.includes('textContent'));});
