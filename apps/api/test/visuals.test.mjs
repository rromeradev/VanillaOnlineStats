// SPDX-License-Identifier: AGPL-3.0-only
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Visuals} from '../dist/visuals.js';
test('media fetches only fixed origins and rejects traversal and injected URLs',async()=>{
  let calls=0;const media=new Visuals(async()=>{calls++;throw new Error('must not fetch');});
  for(const id of ['https://evil.test/x','minecraft:../secret','../stone','minecraft:stone?key=bad'])await assert.rejects(media.image(id));
  await assert.rejects(media.skin('https://evil.test'));await assert.rejects(media.image('minecraft:stone','../../bad'));assert.equal(calls,0);
});
test('skin downloads are deduplicated, bounded and cached',async()=>{
  let calls=0;const png=Buffer.from('89504e470d0a1a0a','hex');
  const media=new Visuals(async(url)=>{calls++;assert.match(url,/^https:\/\/textures.minecraft.net\/texture\/[a-f0-9]+$/);return new Response(png,{headers:{'content-type':'image/png'}});});
  const hash='a'.repeat(64);await Promise.all([media.skin(hash),media.skin(hash)]);await media.skin(hash);assert.equal(calls,1);
  const bad=new Visuals(async()=>new Response('<script>bad</script>',{headers:{'content-type':'image/png'}}));await assert.rejects(bad.skin(hash));
});
test('catalog selects useful metadata without trusting upstream asset URLs',async()=>{
  const media=new Visuals(async(url)=>{assert.match(url,/^https:\/\/blocksitems.com\/api\/2026.1.2\/lookup\//);return new Response(JSON.stringify({result:{type:'block',block:{display_name:'Stone',mod:{display_name:'Minecraft'},icon_url:'http://127.0.0.1/private',properties:{hardness:1.5},colors:{map_color:'#646464'}}}}));});
  const result=await media.item('minecraft:stone');assert.equal(result.name,'Stone');assert.equal(result.properties.hardness,1.5);assert.equal(result.icon,'/api/v1/visuals/icon/minecraft%3Astone');assert.ok(!JSON.stringify(result).includes('127.0.0.1'));
});
