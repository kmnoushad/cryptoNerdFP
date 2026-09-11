'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../data-client');
const response=(data,status=200,range)=>new Response(JSON.stringify(data),{status,headers:range?{'content-range':range}:{}});
const client=(fetch,extra={})=>create({url:'https://example.test',key:'public',getToken:()=> 'test-token',refresh:async()=>false,fetch,...extra});
test('loads beyond server row cap without truncating a full day',async()=>{
  const all=Array.from({length:2600},(_,i)=>({round_number:i+1}));let calls=0;
  const api=client(async(url)=>{
    calls++;const offset=Number(new URL(url).searchParams.get('offset')),page=all.slice(offset,offset+75);
    return response(page,200,offset+'-'+(offset+page.length-1)+'/2600');
  });
  const rows=await api.list('2026-09-11');assert.equal(rows.length,2600);assert.equal(calls,35);
});
test('without count header pagination continues until an empty page',async()=>{
  let calls=0;const api=client(async()=>response(++calls<=3?[{id:calls}]:[]));
  assert.equal((await api.list('2026-09-11')).length,3);assert.equal(calls,4);
});
test('refreshes once on 401, including mutations, but never loops',async()=>{
  let calls=0,refresh=0;
  const api=client(async()=>response({},++calls===1?401:200),{refresh:async()=>{refresh++;return true;}});
  await api.request('/rest/v1/rounds',{method:'PATCH'});assert.equal(calls,2);assert.equal(refresh,1);
  const failed=client(async()=>response({},401),{refresh:async()=>true});
  await assert.rejects(failed.request('/rest/v1/rounds'),/401/);
});
test('failed writes are reported and not blindly retried',async()=>{
  let calls=0;const api=client(async()=>{calls++;return response({message:'blocked'},403);});
  await assert.rejects(api.request('/rest/v1/rounds',{method:'POST'}),/blocked/);assert.equal(calls,1);
});
test('rejects malformed responses and incomplete known totals',async()=>{
  await assert.rejects(client(async()=>new Response('broken')).request('/'),/Invalid server/);
  await assert.rejects(client(async()=>response([],200,'*/10')).list('2026-09-11'),/Incomplete/);
});
test('aborts stalled requests with a useful recovery message',async()=>{
  const api=client((url,init)=>new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')))),{timeout:5});
  await assert.rejects(api.request('/'),/timed out/);
});
