// SPDX-License-Identifier: AGPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, unlinkSync, rmdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runtimeEnvironment } from './runtime.mjs';
const base = {APP_ORIGIN:'https://stats.example.test',VOS_ADMIN_EMAIL:'owner@example.test'};
function fixture(fn) {
  const dir = mkdtempSync(join(tmpdir(),'vos-runtime-'));
  try { fn(dir); } finally { const file=join(dir,'identity.json'); if(existsSync(file)) unlinkSync(file); rmdirSync(dir); }
}
test('generated identity is stable across restarts and empty environment values',()=>fixture(dir=>{
  const a=runtimeEnvironment(base,dir),b=runtimeEnvironment({...base,VOS_TENANT_ID:'',VOS_CONTROL_PRIVATE_KEY:''},dir);
  assert.equal(a.VOS_TENANT_ID,b.VOS_TENANT_ID); assert.equal(a.VOS_CONTROL_PRIVATE_KEY,b.VOS_CONTROL_PRIVATE_KEY);
}));
test('existing installation identity is imported and never silently replaced',()=>fixture(first=>fixture(second=>{
  const imported=runtimeEnvironment(base,first), original=runtimeEnvironment(imported,second);
  assert.equal(original.VOS_TENANT_ID,imported.VOS_TENANT_ID);
  const before=readFileSync(join(second,'identity.json'),'utf8');
  assert.throws(()=>runtimeEnvironment({...imported,VOS_TENANT_ID:'00000000-0000-0000-0000-000000000000'},second));
  assert.equal(readFileSync(join(second,'identity.json'),'utf8'),before);
})));
test('corrupted identity fails closed without generating a new key',()=>fixture(dir=>{
  writeFileSync(join(dir,'identity.json'),'broken'); assert.throws(()=>runtimeEnvironment(base,dir));
  assert.equal(readFileSync(join(dir,'identity.json'),'utf8'),'broken');
}));
test('manual values must be configured before provisioning identity',()=>fixture(dir=>{
  assert.throws(()=>runtimeEnvironment({...base,APP_ORIGIN:''},dir));
  assert.ok(!existsSync(join(dir,'identity.json')));
}));
