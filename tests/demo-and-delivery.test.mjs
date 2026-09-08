import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';

test('two demo roles share a booking, persist across app restart, and never access real or other demo data',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'sternoir-demo-'));
 const settings={dataDir:dir,production:true,appUrl:'https://sternoir.test'};
 let app=createApp(settings),base;
 const listen=async()=>{await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${app.server.address().port}`;};await listen();
 const request=async(path,method='GET',body,cookie='',origin='https://sternoir.test')=>{
  const res=await fetch(base+path,{method,headers:{origin,...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return{status:res.status,body:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0],headers:res.headers};
 };
 try{
  assert.equal((await request('/api/demo/start','POST',{},'','https://attacker.test')).status,403);
  assert.equal((await request('/api/demo/admin/admin')).status,401);
  const session=await request('/api/demo/start','POST',{});assert.equal(session.status,200);assert.match(session.headers.get('set-cookie'),/HttpOnly; SameSite=Lax/);
  const other=await request('/api/demo/start','POST',{});
  const customer=await request('/api/demo/customer/account','GET',null,session.cookie);assert.equal(customer.body.orders.length,1);assert.equal(customer.body.user.role,'customer');
  assert.equal((await request('/api/demo/customer/admin','GET',null,session.cookie)).status,403);
  assert.equal((await request('/api/admin','GET',null,session.cookie)).status,401);
  assert.equal((await request('/api/auth/register','POST',{name:'Real',email:'real@example.test',password:'long-password'})).status,503);
  assert.equal((await request('/api/demo/admin/auth/register','POST',{},session.cookie)).status,403);
  const created=await request('/api/demo/customer/bookings','POST',{name:'Тестовая запись',phone:'+7 (000) 000-00-00',model:'Mercedes E 200',service:'Диагностика',symptom:'Проверка тормозов',consent:true},session.cookie);
  assert.equal(created.status,201);const id=created.body.booking.id;
  const admin=await request('/api/demo/admin/admin','GET',null,session.cookie);assert.equal(admin.body.orders.length,2);assert.ok(admin.body.orders.some(o=>o.id===id));
  assert.equal((await request('/api/demo/admin/admin','GET',null,other.cookie)).body.orders.length,1);
  assert.equal((await request(`/api/demo/admin/admin/orders/${id}`,'PATCH',{status:'scheduled'},other.cookie)).status,404);
  assert.equal((await request(`/api/demo/admin/admin/orders/${id}`,'PATCH',{status:'scheduled',scheduledAt:'2026-10-01T08:00:00Z'},session.cookie)).status,200);
  assert.equal((await request(`/api/demo/admin/admin/orders/${id}`,'PATCH',{status:'diagnostics'},session.cookie)).status,200);
  const quote=await request(`/api/demo/admin/admin/orders/${id}/quote`,'POST',{items:[{title:'Диагностика',quantity:1,unitPrice:4500}],total:1},session.cookie);
  assert.equal(quote.status,201);assert.equal(quote.body.order.quote.total,4500);
  assert.equal((await request(`/api/demo/customer/orders/${id}/approve`,'POST',{quoteId:quote.body.order.quote.id},session.cookie)).status,200);
  assert.equal((await request(`/api/demo/admin/admin/orders/${id}`,'PATCH',{status:'in_progress'},session.cookie)).status,200);
  assert.equal((await request(`/api/demo/customer/orders/${id}/messages`,'POST',{body:'Тестовое сообщение'},session.cookie)).status,201);
  await app.close();app=createApp(settings);await listen();
  const saved=(await request('/api/demo/customer/account','GET',null,session.cookie)).body.orders.find(o=>o.id===id);
  assert.equal(saved.status,'in_progress');assert.equal(saved.messages[0].body,'Тестовое сообщение');assert.equal(saved.quote.status,'approved');
  const reset=await request('/api/demo/reset','POST',{},session.cookie);assert.equal(reset.status,200);
  assert.equal((await request('/api/demo/admin/admin','GET',null,session.cookie)).status,401);
  assert.equal((await request('/api/demo/admin/admin','GET',null,reset.cookie)).body.orders.length,1);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('page arrives rendered, scripts compressed, and video supports initial, suffix and invalid byte ranges',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'sternoir-static-')),app=createApp({dataDir:dir,production:false});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;
 try{
  const page=await fetch(base+'/');const text=await page.text();assert.match(text,/Характер — ваш/);assert.match(text,/data-prerendered="true"/);assert.match(text,/mobile-v1\/hero-g63-poster.webp/);
  const script=await fetch(base+'/app.js?v=20260908-mobile',{headers:{'accept-encoding':'br'}});assert.equal(script.headers.get('content-encoding'),'br');assert.match(await script.text(),/ensureDemo/);assert.ok(Number(script.headers.get('content-length'))<8000);
  const video='/assets/hero-g63-mobile-v1.mp4';
  const first=await fetch(base+video,{headers:{range:'bytes=0-1023'}});assert.equal(first.status,206);assert.equal((await first.arrayBuffer()).byteLength,1024);
  const suffix=await fetch(base+video,{headers:{range:'bytes=-512'}});assert.equal(suffix.status,206);assert.equal((await suffix.arrayBuffer()).byteLength,512);
  assert.equal((await fetch(base+video,{headers:{range:'bytes=999999999-'}})).status,416);
  const mobile=await fetch(base+'/assets/mobile-v1/hero-g63-poster.webp',{method:'HEAD'});assert.match(mobile.headers.get('cache-control'),/immutable/);assert.ok(Number(mobile.headers.get('content-length'))<50000);
  assert.equal((await fetch(base+'/assets/mobile-v1/hero-g63-poster.webp',{headers:{'if-none-match':mobile.headers.get('etag')}})).status,304);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
