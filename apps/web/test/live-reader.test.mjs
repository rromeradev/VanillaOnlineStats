// SPDX-License-Identifier: AGPL-3.0-only
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LiveReader} from '../src/live-reader.ts';
test('automatic reads do not overlap and old pages cannot replace the visible result',async()=>{
  const reader=new LiveReader(), values=[];let finish,calls=0;
  const first=reader.poll('inventory',()=>{calls++;return new Promise(resolve=>finish=resolve);},v=>values.push(v),assert.fail);
  await reader.poll('inventory',async()=>{calls++;},()=>assert.fail('overlap'),assert.fail);
  await reader.poll('statistics',async()=>42,v=>values.push(v),assert.fail);
  finish('stale inventory');await first;assert.equal(calls,1);assert.deepEqual(values,[42]);
});
test('automatic reads back off on failure and recover without a refresh button',async()=>{
  const reader=new LiveReader();let calls=0,errors=0,result;
  await reader.poll('page',async()=>{calls++;throw new Error('offline');},()=>{},()=>errors++);
  await reader.poll('page',async()=>{calls++;},()=>{},()=>{});
  assert.equal(calls,1);assert.equal(errors,1);
  await reader.poll('page',async()=>{calls++;return 'online';},v=>result=v,assert.fail,Date.now()+31000);
  assert.equal(result,'online');assert.equal(calls,2);
});
