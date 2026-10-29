// SPDX-License-Identifier: AGPL-3.0-only
import {IncomingMessage,Server as HttpServer} from 'node:http';
import {WebSocket,WebSocketServer} from 'ws';
import {Database,Server,Session} from './database';
import {Control} from './control';
import {Limits,fail} from './security';

export interface PanelView {id:number;actor:Session;server:Server & {role?:string};section:string;hours:number;query?:{operation:string;args:any}}
export class PanelStream {
  private wss=new WebSocketServer({noServer:true,maxPayload:8192,perMessageDeflate:false});
  private counts=new Map<string,number>();private limits=new Limits();private clients=new Set<WebSocket>();
  constructor(server:HttpServer,private db:Database,private control:Control,origin:string,
      private authenticate:(req:IncomingMessage)=>Promise<Session>,
      private normalize:(actor:Session,value:any)=>Promise<PanelView>,
      private authorize:(req:IncomingMessage,view:PanelView)=>Promise<void>,
      private snapshot:(view:PanelView)=>Promise<any>,
      private project:(view:PanelView,messages:any[])=>any[]) {
    server.on('upgrade',(req,socket,head)=>{if(req.url!=='/api/v1/panel')return;socket.on('error',()=>{});void(async()=>{
      if(req.headers.origin!==origin)fail(403);this.limits.check('upgrade:'+req.socket.remoteAddress,60);
      const actor=await this.authenticate(req);if((this.counts.get(actor.token_hash)??0)>=4)fail(429);
      this.counts.set(actor.token_hash,(this.counts.get(actor.token_hash)??0)+1);
      let attached=false;try{this.wss.handleUpgrade(req,socket,head,ws=>{attached=true;this.attach(ws,req,actor);});}finally{if(!attached){const count=(this.counts.get(actor.token_hash)??1)-1;if(count<=0)this.counts.delete(actor.token_hash);else this.counts.set(actor.token_hash,count);}}
    })().catch(()=>socket.destroy());});
  }
  private attach(ws:WebSocket,req:IncomingMessage,actor:Session){
    this.clients.add(ws);let generation=0,view:PanelView|undefined,unwatch:(()=>void)|undefined,remove:(()=>void)|undefined,serial=Promise.resolve(),alive=true,queued=0;
    const cleanup=()=>{generation++;unwatch?.();unwatch=undefined;remove?.();remove=undefined;view=undefined;};
    const send=(value:any)=>{if(ws.readyState!==WebSocket.OPEN)return;const json=JSON.stringify(value);if(Buffer.byteLength(json)>4*1024*1024||ws.bufferedAmount>4*1024*1024){ws.close(1013,'Slow consumer');return;}ws.send(json);};
    const stop=(error:any)=>{cleanup();const code=error?.getStatus?.();ws.close(code===401?4401:code===403||code===404?4403:1011,'Subscription unavailable');};
    const enqueue=(revision:number,task:(current:PanelView)=>Promise<void>|void)=>{
      if(++queued>64){queued--;ws.close(1013,'Slow consumer');return;}
      serial=serial.then(async()=>{if(!view||generation!==revision||ws.readyState!==WebSocket.OPEN)return;await this.authorize(req,view);if(generation!==revision||!view)return;await task(view);}).catch(stop).finally(()=>{queued--;});
    };
    ws.on('pong',()=>alive=true);ws.on('error',()=>{});
    ws.on('message',(data,binary)=>{void(async()=>{
      this.limits.check('subscriptions:'+actor.token_hash,120);if(binary)fail(400);const value=JSON.parse(data.toString());
      if(value.type==='unsubscribe'){cleanup();send({type:'paused'});return;}
      cleanup();const revision=generation;const current=await this.normalize(await this.authenticate(req),value);if(generation!==revision)return;view=current;
      const listener=(change?:{messages:any[]})=>enqueue(revision,async active=>{
        if(change?.messages){for(const packet of this.project(active,change.messages))send({...packet,id:active.id});send({type:'server',id:active.id,server:{online:true,lastSeen:active.server.last_seen,controlConnected:this.control.connected(active.server.id)}});
          if(active.actor.kind==='ADMIN'&&active.section==='overview'&&change.messages.some(e=>e.type==='server.performance.snapshot')){const items=await this.db.rows('SELECT rule,active,value,acknowledged_by,first_seen,last_seen FROM vos_alerts WHERE tenant_id=$1 AND server_id=$2 ORDER BY active DESC,rule',[active.server.tenant_id,active.server.id]);if(generation===revision)send({type:'alerts',id:active.id,items});}
        }
        else {const data=await this.snapshot(active);if(generation===revision&&view===active)send({type:'snapshot',id:active.id,data});}
      });
      this.db.changes.on(current.server.id,listener);remove=()=>this.db.changes.off(current.server.id,listener);
      enqueue(revision,async active=>{
        const data=await this.snapshot(active);if(generation!==revision||view!==active)return;await this.authorize(req,active);if(generation!==revision)return;send({type:'snapshot',id:active.id,data});
        if(active.actor.kind==='PLAYER'&&active.query){const saved=await this.db.savedPlayer(active.server,active.actor.actor_id,active.query.operation,active.query.args);if(saved&&generation===revision)send({type:'query',id:active.id,result:saved});}
        if(active.query){await this.db.audit(active.server,active.actor.actor_id,'watch.'+active.query.operation,'STARTED');
          if(generation!==revision||view!==active)return;
          try{unwatch=this.control.watch(active.server,{...active.actor,role:active.server.role},active.query.operation,active.query.args,result=>enqueue(revision,async latest=>{
            const safe=structuredClone(result);if(latest.actor.kind==='PLAYER'&&safe.payload){if(safe.payload.uuid&&safe.payload.uuid!==latest.actor.actor_id)fail(403);delete safe.payload.address;delete safe.payload.permissions;}
            if(latest.actor.kind==='PLAYER'&&latest.query&&safe.state!=='SUCCEEDED'){const saved=await this.db.savedPlayer(latest.server,latest.actor.actor_id,latest.query.operation,latest.query.args);if(saved){send({type:'query',id:latest.id,result:saved});return;}}
            send({type:'query',id:latest.id,result:safe});
          }));}catch(error:any){if(error?.getStatus?.()===429)send({type:'query',id:active.id,result:{state:'FAILED',payload:{reasonCode:'SUBSCRIPTION_LIMIT'}}});else throw error;}}
      });
    })().catch(error=>{if(error?.getStatus?.()===400){send({type:'error',message:'Assinatura inválida.'});return;}stop(error);});});
    const timer=setInterval(()=>{if(!alive){ws.terminate();return;}alive=false;ws.ping();void this.authenticate(req).then(async()=>{
      if(view){await this.authorize(req,view);send({type:'server',id:view.id,server:{online:!!view.server.last_seen&&Date.now()-new Date(view.server.last_seen).getTime()<45000,lastSeen:view.server.last_seen,controlConnected:this.control.connected(view.server.id)}});}
    }).catch(stop);},15000);timer.unref();
    ws.on('close',()=>{clearInterval(timer);cleanup();this.clients.delete(ws);const count=(this.counts.get(actor.token_hash)??1)-1;if(count<=0)this.counts.delete(actor.token_hash);else this.counts.set(actor.token_hash,count);});
    send({type:'ready'});
  }
  async close(){for(const ws of this.clients)ws.terminate();this.wss.close();}
}
