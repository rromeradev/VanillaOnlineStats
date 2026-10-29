// SPDX-License-Identifier: AGPL-3.0-only
import { Component, Injectable, Input, Output, EventEmitter, ElementRef, ViewChild, AfterViewInit, OnChanges, OnDestroy, inject, signal } from '@angular/core';
import { Api } from './api';
export function registryId(value:any):string|null {
  if(typeof value!=='string')return null;const id=value.includes(':')?value:value.toLowerCase().includes('_')||/^[A-Z]+$/.test(value)?'minecraft:'+value.toLowerCase():'';
  return /^[a-z0-9_.-]{1,64}:[a-z0-9_][a-z0-9_./-]{0,127}$/.test(id)&&!id.includes('..')?id:null;
}
export function skinUrl(skin:any):string|null {return /^[a-f0-9]{32,64}$/.test(skin?.textureHash??'')?'/api/v1/visuals/skin/'+skin.textureHash:null;}
@Injectable({providedIn:'root'}) export class ItemCatalog {
  private api=inject(Api); private cache=new Map<string,Promise<any>>(); private queue:(()=>void)[]=[];private active=0;
  private drain(){while(this.active<3&&this.queue.length){this.active++;this.queue.shift()!();}}
  get(id:string){let request=this.cache.get(id);if(!request){if(this.cache.size>=512)this.cache.delete(this.cache.keys().next().value!);request=new Promise(resolve=>{this.queue.push(()=>{void this.api.request('visuals/item/'+encodeURIComponent(id)).then(resolve).catch(()=>resolve(null)).finally(()=>{this.active--;this.drain();});});});this.cache.set(id,request);this.drain();}return request;}
}
@Component({selector:'vos-item',template:`<button type="button" class="item-visual" [class.with-label]="label" (click)="inspect.emit(id)" [title]="metadata()?.name || id"><span class="item-picture">@if(!failed()&&id){<img [src]="url" [alt]="metadata()?.name || id" loading="lazy" decoding="async" (error)="failed.set(true)">}@else{<span aria-hidden="true">▧</span>}</span>@if(label){<span>{{metadata()?.name || fallback()}}</span>}@if(amount>1){<b>{{amount}}</b>}</button>`})
export class ItemVisual implements OnChanges {
  @Input() value='';@Input() amount=1;@Input() label=false;@Output() inspect=new EventEmitter<string>();
  catalog=inject(ItemCatalog);metadata=signal<any>(null);failed=signal(false);id='';url='';
  ngOnChanges(){this.id=registryId(this.value)??'';this.url='https://blocksitems.com/api/2026.1.2/icon/'+encodeURIComponent(this.id)+'.png?size=64&placeholder=404';this.failed.set(false);this.metadata.set(null);const id=this.id;if(id)void this.catalog.get(id).then(v=>{if(this.id===id)this.metadata.set(v);});}
  fallback(){return this.value.replace(/^minecraft:/,'').replaceAll('_',' ');}
}
@Component({selector:'vos-head',template:`<span class="skin-head" [attr.title]="name"><canvas #canvas width="64" height="64" [hidden]="!ready()" role="img" [attr.aria-label]="'Cabeça de '+name"></canvas>@if(!ready()){<span>{{name.slice(0,2).toUpperCase() || '?'}}</span>}</span>`})
export class PlayerHead implements AfterViewInit,OnChanges,OnDestroy {
  @Input() skin:any;@Input() name='';@ViewChild('canvas') canvas?:ElementRef<HTMLCanvasElement>;
  ready=signal(false);private version=0;private alive=true;private loaded='';
  ngAfterViewInit(){this.draw();}ngOnChanges(){this.draw();}ngOnDestroy(){this.alive=false;this.version++;}
  private draw(){const canvas=this.canvas?.nativeElement;if(!canvas)return;const url=skinUrl(this.skin);if(url&&url===this.loaded)return;this.loaded=url??'';const generation=++this.version;this.ready.set(false);if(!url)return;const img=new Image();img.onload=()=>{if(!this.alive||generation!==this.version)return;if(img.width<64||img.width>1024||img.width%64!==0||![img.width,img.width/2].includes(img.height))return;const scale=img.width/64,ctx=canvas.getContext('2d');if(!ctx)return;ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,64,64);ctx.drawImage(img,8*scale,8*scale,8*scale,8*scale,0,0,64,64);const source=document.createElement('canvas');source.width=img.width;source.height=img.height;const src=source.getContext('2d');if(src){src.drawImage(img,0,0);const pixels=src.getImageData(0,0,img.width,img.height).data;let transparent=false;for(let i=3;i<pixels.length;i+=4){if(pixels[i]<255){transparent=true;break;}}if(transparent)ctx.drawImage(img,40*scale,8*scale,8*scale,8*scale,0,0,64,64);}this.ready.set(true);};img.src=url;}
}
@Component({selector:'vos-skin',template:`<div class="skin-model"><canvas #canvas [hidden]="!ready()" role="img" [attr.aria-label]="'Modelo 3D de '+name"></canvas>@if(ready()){<div class="skin-controls"><button type="button" (click)="rotate(-.4)" aria-label="Girar para a esquerda">↶</button><span>Arraste para girar</span><button type="button" (click)="rotate(.4)" aria-label="Girar para a direita">↷</button></div>}@else{<div class="skin-empty"><span>♟</span><small>{{message()}}</small></div>}</div>`})
export class PlayerModel implements AfterViewInit,OnChanges,OnDestroy {
  @Input() skin:any;@Input() name='';@ViewChild('canvas') canvas?:ElementRef<HTMLCanvasElement>;
  ready=signal(false);message=signal('Skin ainda não observada');private viewer:any;private observer?:IntersectionObserver;private visible=false;private version=0;private alive=true;private loaded='';
  ngAfterViewInit(){this.observer=new IntersectionObserver(entries=>{this.visible=entries[0].isIntersecting;if(this.viewer)this.viewer.renderPaused=!this.visible;if(this.visible)void this.load();});this.observer.observe(this.canvas!.nativeElement.parentElement!);}
  ngOnChanges(){if(this.visible)void this.load();}
  ngOnDestroy(){this.alive=false;this.version++;this.observer?.disconnect();this.viewer?.dispose();}
  rotate(amount:number){if(this.viewer)this.viewer.playerObject.rotation.y+=amount;}
  private async load(){const url=skinUrl(this.skin),key=url+':'+this.skin?.model;if(!url){this.version++;this.loaded='';if(this.viewer)this.viewer.renderPaused=true;this.ready.set(false);this.message.set('Skin ainda não observada');return;}if(this.loaded===key)return;this.loaded=key;const version=++this.version;this.ready.set(false);this.viewer?.dispose();this.viewer=undefined;
    try{const {SkinViewer}=await import('skinview3d');if(!this.alive||version!==this.version)return;
      if(!this.viewer){this.viewer=new SkinViewer({canvas:this.canvas!.nativeElement,width:240,height:290,zoom:.85});this.viewer.controls.enableZoom=false;this.viewer.controls.enablePan=false;this.viewer.autoRotate=false;}
      const viewer=this.viewer;await viewer.loadSkin(url,{model:this.skin?.model==='slim'?'slim':'default'});if(!this.alive||version!==this.version)return;viewer.renderPaused=!this.visible;this.ready.set(true);
    }catch{if(this.alive&&version===this.version){this.ready.set(false);this.message.set('Modelo 3D indisponível neste navegador');this.loaded='';}}
  }
}
export function visualIds(value:any):string[]{const result=new Set<string>();function visit(v:any,depth:number){if(depth>7||result.size>=24)return;if(typeof v==='string'){const id=v.includes(':')?registryId(v):null;if(id&&!id.endsWith(':air'))result.add(id);}else if(v&&typeof v==='object'){for(const [key,item]of Object.entries(v)){if(['uuid','worldId','entityId','playerId','location','skin','permissions','tags','plugins','advancement','key','statistic','biome','effects'].includes(key))continue;visit(item,depth+1);}}}visit(value,0);return [...result];}
