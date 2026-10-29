// SPDX-License-Identifier: AGPL-3.0-only
import {test} from 'node:test';import assert from 'node:assert/strict';
import {PanelSocket} from '../src/panel-socket.ts';
class Socket {readyState=0;sent=[];send(value){this.sent.push(JSON.parse(value));}open(){this.readyState=1;this.onopen?.({});}message(value){this.onmessage?.({data:JSON.stringify(value)});}close(code=1000){this.readyState=3;this.onclose?.({code});}}
test('one subscription receives pushed data; unchanged subscriptions send no new requests',()=>{
 const socket=new Socket(),values=[];const client=new PanelSocket(v=>values.push(v),()=>{},assert.fail,()=>socket);
 const view={serverId:'one',section:'inventory'};client.subscribe(view);assert.equal(socket.sent.length,0);socket.open();assert.equal(socket.sent.length,1);
 socket.message({type:'query',id:1,result:{amount:1}});socket.message({type:'query',id:1,result:{amount:2}});client.subscribe(view);
 assert.deepEqual(values.map(v=>v.result.amount),[1,2]);assert.equal(socket.sent.length,1);
 client.subscribe({...view,serverId:'two'});socket.message({type:'query',id:1,result:{amount:99}});assert.equal(values.length,2);
 client.pause();assert.equal(socket.sent.at(-1).type,'unsubscribe');socket.message({type:'query',id:2,result:{amount:99}});assert.equal(values.length,2);client.close();
});
test('reconnection restores the subscription without periodic HTTP and ignores the previous socket',t=>{
 t.mock.timers.enable({apis:['setTimeout']});const sockets=[],values=[];
 const client=new PanelSocket(v=>values.push(v),()=>{},assert.fail,()=>{const s=new Socket();sockets.push(s);return s;});
 client.subscribe({serverId:'one',section:'worlds'});sockets[0].open();sockets[0].close(1006);t.mock.timers.tick(1000);assert.equal(sockets.length,2);sockets[1].open();assert.equal(sockets[1].sent.length,1);
 sockets[0].message({id:1,type:'telemetry'});assert.equal(values.length,0);sockets[1].message({id:1,type:'telemetry'});assert.equal(values.length,1);
 t.mock.timers.tick(60000);assert.equal(sockets[1].sent.length,1);client.close();
});
test('expired sessions stop reconnecting',t=>{
 t.mock.timers.enable({apis:['setTimeout']});const socket=new Socket();let code;const client=new PanelSocket(()=>{},()=>{},v=>code=v,()=>socket);socket.open();socket.close(4401);t.mock.timers.tick(60000);assert.equal(code,4401);client.close();
});
