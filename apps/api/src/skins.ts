// SPDX-License-Identifier: AGPL-3.0-only
import {fail} from './security';

/** Public catalogue reads only; never accepts a caller-supplied URL. */
export class SkinCatalog {
  private cached?:{until:number;items:any[]};private loading?:Promise<any[]>;
  constructor(private fetcher:typeof fetch=fetch){}
  private async json(path:string){
    const response=await this.fetcher('https://api.mineskin.org/v2/skins/'+path,{redirect:'error',signal:AbortSignal.timeout(8000),headers:{'User-Agent':'VanillaOnlineStats/0.7 (+https://github.com/rromeradev/VanillaOnlineStats)'}});
    if(!response.ok)fail(503);
    const reader=response.body!.getReader();const chunks:Uint8Array[]=[];let size=0;
    try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>262144){await reader.cancel();fail(413);}chunks.push(part.value);}}finally{reader.releaseLock();}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  async popular(){
    if(this.cached&&this.cached.until>Date.now())return this.cached.items;
    if(this.loading)return this.loading;
    this.loading=(async()=>{const result=await this.json('popular');if(!Array.isArray(result.skins))fail(503);
      const items=result.skins.slice(0,30).filter((skin:any)=>/^[a-f0-9]{32}$/.test(skin.uuid)&&/^[a-f0-9]{64}$/.test(skin.texture)).map((skin:any,index:number)=>({id:skin.uuid,name:typeof skin.name==='string'?skin.name.slice(0,80):'Skin popular '+(index+1),skin:{textureHash:skin.texture,source:'mineskin'},source:'https://mineskin.org/skins/'+skin.uuid}));
      this.cached={until:Date.now()+3600000,items};return items;})();
    try{return await this.loading;}finally{this.loading=undefined;}
  }
  async property(id:string){
    if(!/^[a-f0-9]{32}$/.test(id)||!(await this.popular()).some(s=>s.id===id))fail(400);
    const result=await this.json(id),data=result.skin?.texture?.data;
    if(typeof data?.value!=='string'||data.value.length>4096||typeof data.signature!=='string'||data.signature.length>2048)fail(503);
    return {value:data.value,signature:data.signature};
  }
}

export function skinUpload(value:any){
  if(typeof value!=='string'||value.length>27308||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))fail(400);
  const bytes=Buffer.from(value,'base64');
  if(bytes.length<33||bytes.length>20480||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.toString('ascii',12,16)!=='IHDR'||bytes.readUInt32BE(16)!==64||![32,64].includes(bytes.readUInt32BE(20)))fail(400);
  return value;
}
