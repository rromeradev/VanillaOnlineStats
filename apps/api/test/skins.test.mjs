// SPDX-License-Identifier: AGPL-3.0-only
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SkinCatalog,skinUpload} from '../dist/skins.js';

test('popular catalogue is cached and resolves only listed IDs from its fixed source',async()=>{
  const id='a'.repeat(32),texture='b'.repeat(64);let calls=0;
  const catalog=new SkinCatalog(async url=>{calls++;assert.match(url,/^https:\/\/api.mineskin.org\/v2\/skins\/(popular|a+)$/);return new Response(JSON.stringify(url.endsWith('popular')?{skins:[{uuid:id,texture,name:'Popular'}, {uuid:'bad',texture:'https://evil.test'}]}:{skin:{texture:{data:{value:'signed-value',signature:'signed-signature'}}}}));});
  const [first,second]=await Promise.all([catalog.popular(),catalog.popular()]);assert.equal(calls,1);assert.deepEqual(first,second);assert.equal(first.length,1);assert.equal(first[0].skin.textureHash,texture);
  await assert.rejects(catalog.property('c'.repeat(32)));assert.equal(calls,1);
  assert.deepEqual(await catalog.property(id),{value:'signed-value',signature:'signed-signature'});assert.equal(calls,2);
  await assert.rejects(catalog.property('http://127.0.0.1/private'));assert.equal(calls,2);
});
test('upstream errors, malformed catalogue and oversized responses are rejected',async()=>{
  await assert.rejects(new SkinCatalog(async()=>new Response('',{status:403})).popular());
  await assert.rejects(new SkinCatalog(async()=>new Response('{}')).popular());
  await assert.rejects(new SkinCatalog(async()=>new Response('x'.repeat(262145))).popular());
});
test('skin uploads bound encoded size and PNG dimensions before contacting the agent',()=>{
  const bytes=Buffer.alloc(33);Buffer.from('89504e470d0a1a0a','hex').copy(bytes);bytes.write('IHDR',12);bytes.writeUInt32BE(64,16);bytes.writeUInt32BE(64,20);
  assert.equal(skinUpload(bytes.toString('base64')),bytes.toString('base64'));
  for(const bad of ['', '../secret', 'A'.repeat(27312), Buffer.from('not a png').toString('base64')])assert.throws(()=>skinUpload(bad));
  bytes.writeUInt32BE(100000,16);assert.throws(()=>skinUpload(bytes.toString('base64')));
});
