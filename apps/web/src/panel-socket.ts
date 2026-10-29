// SPDX-License-Identifier: AGPL-3.0-only
// Persistent subscriptions. Timers are used only to reconnect a lost socket.
export class PanelSocket {
  private socket?:WebSocket;
  private desired:any=null;private key='';private revision=0;private closed=false;private delay=500;
  private retry?:ReturnType<typeof setTimeout>;
  private healthy?:ReturnType<typeof setTimeout>;
  private receive:(value:any)=>void;private status:(value:string)=>void;private expired:(code:number)=>void;private create:()=>WebSocket;
  constructor(receive:(value:any)=>void,status:(value:string)=>void,expired:(code:number)=>void,
      create:()=>WebSocket=()=>new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/api/v1/panel')){this.receive=receive;this.status=status;this.expired=expired;this.create=create;this.connect();}
  subscribe(value:any,force=false){const key=JSON.stringify(value);if(!force&&key===this.key)return false;this.key=key;this.desired=value;this.revision++;this.flush();return true;}
  pause(){if(!this.desired)return;this.desired=null;this.key='';this.revision++;if(this.socket?.readyState===1)this.socket.send(JSON.stringify({type:'unsubscribe'}));}
  close(){this.closed=true;clearTimeout(this.retry);clearTimeout(this.healthy);const socket=this.socket;this.socket=undefined;socket?.close(1000);}
  private flush(){if(this.desired&&this.socket?.readyState===1)this.socket.send(JSON.stringify({...this.desired,type:'subscribe',id:this.revision}));}
  private connect(){
    if(this.closed)return;this.status('Conectando');const socket=this.create();this.socket=socket;
    socket.onopen=()=>{if(this.socket!==socket)return;this.healthy=setTimeout(()=>this.delay=500,30000);this.status('Ao vivo · WebSocket');this.flush();};
    socket.onmessage=event=>{if(this.socket!==socket||this.closed)return;try{const value=JSON.parse(event.data);if(value.id!=null&&value.id!==this.revision)return;if(value.type!=='ready'&&value.type!=='paused')this.receive(value);}catch{socket.close(1002);}};
    socket.onerror=()=>{if(this.socket===socket)this.status('Reconectando');};
    socket.onclose=event=>{if(this.socket!==socket||this.closed)return;clearTimeout(this.healthy);this.socket=undefined;
      if(event.code===4401||event.code===4403){this.closed=true;this.expired(event.code);return;}
      this.status('Reconectando');const delay=this.delay;this.delay=Math.min(30000,this.delay*2);this.retry=setTimeout(()=>this.connect(),delay+Math.random()*250);
    };
  }
}
