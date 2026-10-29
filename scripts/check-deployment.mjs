// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const origin = process.argv.slice(2).find(value=>/^https?:/.test(value)) ?? 'http://127.0.0.1:3000';
const health = await fetch(origin + '/api/v1/health');
assert.ok(health.ok, 'API health');
for (const path of ['/', '/login', '/admin/overview', '/player/overview']) {
  const response = await fetch(origin + path);
  assert.ok(response.ok, 'SPA route ' + path);
  const html = await response.text();
  assert.ok(html.includes('<vos-root>'), 'Angular entry point');
  assert.ok(!html.includes('media="print"'), 'CSP-compatible styles');
  const css = /href="(styles-[^"]+\.css)"/.exec(html)?.[1];
  const js = /src="(main-[^"]+\.js)"/.exec(html)?.[1];
  assert.ok(css && js, 'Compiled assets');
  assert.ok((await fetch(origin + '/' + css)).ok, 'Styles served');
  assert.ok((await fetch(origin + '/' + js)).ok, 'JavaScript served');
  assert.ok(response.headers.get('content-security-policy')?.includes("script-src 'self'"));
}
console.log('Deployment verified: root, login, SPA routes, JavaScript, CSS and API.');
if(process.argv.includes('--websocket')){
  const configured=process.env.APP_ORIGIN??origin;
  const login=await fetch(origin+'/api/v1/auth/admin/login',{method:'POST',headers:{Origin:configured,'Content-Type':'application/json'},body:JSON.stringify({email:process.env.VOS_ADMIN_EMAIL,password:process.env.VOS_ADMIN_PASSWORD})});
  assert.equal(login.status,200,'Disposable deployment login');const cookie=login.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
  const require=createRequire(new URL('../apps/api/package.json',import.meta.url)),WebSocket=require('ws');
  const socket=new WebSocket(origin.replace(/^http/,'ws')+'/api/v1/panel',{headers:{Origin:configured,Cookie:cookie}});
  try{await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Panel WebSocket timeout')),5000);socket.once('message',data=>{clearTimeout(timer);try{assert.equal(JSON.parse(data).type,'ready');resolve();}catch(error){reject(error);}});socket.once('error',reject);});console.log('Deployment verified: authenticated panel WebSocket upgrade.');}
  finally{socket.close();}
}
