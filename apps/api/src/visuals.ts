// SPDX-License-Identifier: AGPL-3.0-only
import { fail } from './security';
const BASE='https://blocksitems.com/api/2026.1.2';
export const REGISTRY_ID=/^[a-z0-9_.-]{1,64}:[a-z0-9_][a-z0-9_./-]{0,127}$/;
export class Visuals {
  private cache=new Map<string,{bytes:Buffer;type:string;until:number}>(); private bytes=0;
  private inflight=new Map<string,Promise<{bytes:Buffer;type:string}>>();
  constructor(private fetcher:typeof fetch=fetch){}
  private async load(key:string,url:string,json=false) {
    const cached=this.cache.get(key);if(cached&&cached.until>Date.now())return cached;
    const pending=this.inflight.get(key);if(pending)return pending;
    if(this.inflight.size>=12)fail(429);
    const request=(async()=>{
      const response=await this.fetcher(url,{signal:AbortSignal.timeout(4000),redirect:'error'});
      if(!response.ok)fail(response.status===404?404:503);
      const reader=response.body!.getReader();const chunks:Uint8Array[]=[];let size=0;
      try{for(;;){const v=await reader.read();if(v.done)break;size+=v.value.length;if(size>1048576){await reader.cancel();fail(413);}chunks.push(v.value);}}finally{reader.releaseLock();}
      const bytes=Buffer.concat(chunks);const type=response.headers.get('content-type')??'';
      if(!json && (!type.startsWith('image/png')||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'))fail(503);
      if(json)JSON.parse(bytes.toString());
      if(cached){this.bytes-=cached.bytes.length;this.cache.delete(key);}
      while(this.bytes+bytes.length>16777216||this.cache.size>=256){const first=this.cache.keys().next().value;if(!first)break;this.bytes-=this.cache.get(first)!.bytes.length;this.cache.delete(first);}
      const result={bytes,type:json?'application/json':'image/png',until:Date.now()+86400_000};this.cache.set(key,result);this.bytes+=bytes.length;return result;
    })();this.inflight.set(key,request);try{return await request;}finally{this.inflight.delete(key);}
  }
  async image(id:string,angle?:string){if(!REGISTRY_ID.test(id)||id.includes('..'))fail(400);if(angle&&!['iso','low','front','side','top'].includes(angle))fail(400);
    return this.load('image:'+id+':'+(angle??'icon'),angle?`${BASE}/blocks/${encodeURIComponent(id)}/render.png?angle=${angle}&size=256&placeholder=404`:`${BASE}/icon/${encodeURIComponent(id)}.png?size=64&placeholder=404`);}
  async skin(hash:string){if(!/^[a-f0-9]{32,64}$/.test(hash))fail(400);return this.load('skin:'+hash,'https://textures.minecraft.net/texture/'+hash);}
  async item(id:string){if(!REGISTRY_ID.test(id)||id.includes('..'))fail(400);
    const raw=JSON.parse((await this.load('item:'+id,`${BASE}/lookup/${encodeURIComponent(id)}?fields=colors&mc_version=26.3`,true)).bytes.toString());
    const r=raw.result;if(!r)fail(404);const data=r.item??r.block;
    return {id,type:r.type,name:data?.display_name??id,mod:data?.mod?.display_name??null,properties:data?.properties??{},colors:r.colors??data?.colors??null,
      icon:'/api/v1/visuals/icon/'+encodeURIComponent(id),source:'https://blocksitems.com/pt-BR',available:true};
  }
}
