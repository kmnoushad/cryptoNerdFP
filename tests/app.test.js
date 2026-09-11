'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../prediction-core'),T=require('../data-client');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const source=html.match(/<script>([\s\S]*?)<\/script>/)[1];
function app(){
  const elements=new Map(),storage=new Map();
  const element=id=>{if(!elements.has(id))elements.set(id,{value:'1',textContent:'',innerHTML:'',style:{},classList:{add(){},remove(){},toggle(){}}});return elements.get(id);};
  const ctx={RoundCore:C,RoundTransport:T,Date,AbortController,Number,console,
    fetch:async()=>{throw new Error('Unexpected external request');},
    setTimeout:()=>1,clearTimeout(){},confirm:()=>true,
    document:{getElementById:element,querySelector:element,querySelectorAll:()=>[]},
    window:{addEventListener(){}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)}};
  vm.createContext(ctx);vm.runInContext(source,ctx);
  ctx.uid='test-user';ctx.isAdmin=true;ctx.tok='token';ctx.curDate=ctx.todayUAE();ctx.loadedDate=ctx.curDate;
  return {ctx,element,storage};
}
function rows(ctx,n,start=1){return Array.from({length:n},(_,i)=>({id:'id-'+(start+i),round_number:start+i,play_date:ctx.curDate,code:C.CODES[i%8],play_time:'12:00:00'}));}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
test('inline app syntax and complete populated/empty renders are valid',()=>{
  const {ctx,element}=app();ctx.rounds=rows(ctx,150);ctx.ui();assert.match(element('pinfo').textContent,/walk-forward/);
  ctx.rounds=[];ctx.ui();assert.equal(element('p25-hot').textContent,'—');assert.equal(element('p100-pick').textContent,'—');
});
test('a slow older date response never replaces the newly selected day',async()=>{
  const {ctx}=app(),first=deferred(),second=deferred(),old=ctx.curDate,oldRows=rows(ctx,3);
  ctx.transport={list:date=>date===old?first.promise:second.promise};
  const a=ctx.loadRounds();ctx.curDate='2026-01-01';const newRows=rows(ctx,4),b=ctx.loadRounds();
  second.resolve(newRows);await b;first.resolve(oldRows);await a;
  assert.equal(ctx.loadedDate,'2026-01-01');assert.equal(ctx.rounds.length,4);
  assert.ok(ctx.rounds.every(r=>r.play_date==='2026-01-01'));
});
test('rapid double entry produces a single mutation and advances once',async()=>{
  const {ctx,element}=app(),pending=deferred();ctx.rounds=rows(ctx,20);ctx.ui();element('rnum').value='21';
  let calls=0;ctx.transport={request:()=>{calls++;return pending.promise;}};
  const a=ctx.enter('W');await ctx.enter('G');assert.equal(calls,1);
  pending.resolve({data:[{id:'new',round_number:21,code:'W',play_date:ctx.curDate}]});await a;
  assert.equal(ctx.rounds.length,21);assert.equal(element('rnum').value,22);assert.equal(ctx.writeBusy,false);
});
test('invalid input and read-only users cannot write',async()=>{
  const {ctx,element}=app();let calls=0;ctx.transport={request:()=>{calls++;}};
  for(const value of ['0','2601','1.5','bad']){element('rnum').value=value;await ctx.enter('T');}
  ctx.isAdmin=false;element('rnum').value='1';await ctx.enter('T');assert.equal(calls,0);
});
test('failed mutation clears uncertain analysis and requires refresh',async()=>{
  const {ctx,element}=app();ctx.rounds=rows(ctx,20);element('rnum').value='21';
  ctx.transport={request:async()=>{throw new Error('blocked by RLS');}};await ctx.enter('T');
  assert.equal(ctx.loadedDate,null);assert.equal(ctx.writeBusy,false);assert.equal(ctx.rounds.length,0);
  assert.match(element('toast').textContent,/blocked by RLS/);
});
test('no-op edit/delete responses are failures rather than false success',async()=>{
  const {ctx}=app();ctx.transport={request:async()=>({data:[]})};
  await assert.rejects(ctx.mutateRound('/','DELETE'),/No row changed/);
});
test('forecasts are frozen, graded once, and invalidated by historical edits',()=>{
  const {ctx}=app();ctx.rounds=rows(ctx,20);ctx.stashPredictions();
  const key=ctx.curDate+'#21',before=JSON.stringify(ctx.loadLedger()[key]);
  ctx.stashPredictions();assert.equal(JSON.stringify(ctx.loadLedger()[key]),before);
  ctx.rounds.push({id:'21',round_number:21,play_date:ctx.curDate,code:'T'});
  ctx.gradeRound(21,'T');ctx.gradeRound(21,'T');
  assert.equal(Object.values(ctx.loadLedger()).filter(x=>x.actual).length,1);
  ctx.rounds[5].code='W';ctx.reconcileScores();assert.equal(Object.keys(ctx.loadLedger()).length,0);
});
test('historical dates, downward entry and accounts have separate scoring behavior',()=>{
  const {ctx}=app();ctx.rounds=rows(ctx,20);ctx.enterDir=-1;ctx.stashPredictions();assert.equal(Object.keys(ctx.loadLedger()).length,0);
  ctx.enterDir=1;ctx.stashPredictions();assert.equal(Object.keys(ctx.loadLedger()).length,1);
  ctx.uid='another';assert.equal(Object.keys(ctx.loadLedger()).length,0);
  ctx.curDate='2020-01-01';ctx.loadedDate=ctx.curDate;ctx.stashPredictions();assert.equal(Object.keys(ctx.loadLedger()).length,0);
});
test('prospective results loaded by another viewer can be graded without re-entry',async()=>{
  const {ctx}=app();ctx.rounds=rows(ctx,20);ctx.stashPredictions();const all=rows(ctx,21);
  ctx.transport={list:async()=>all};await ctx.loadRounds();
  assert.equal(Object.values(ctx.loadLedger()).filter(x=>x.actual).length,1);
});
test('corrupt storage does not break accuracy rendering',()=>{
  const {ctx,storage}=app();storage.set(ctx.scoreKey(),JSON.stringify({bad:null,other:{date:ctx.curDate}}));
  ctx.renderAccuracy();assert.equal(Object.keys(ctx.loadLedger()).length,0);
});
test('absence never changes probability when frequencies are identical',()=>{
  const {ctx}=app();ctx.rounds=rows(ctx,80);const a=ctx.calcLast100Model();
  const codes=ctx.rounds.map(r=>r.code).reverse();ctx.rounds.forEach((r,i)=>r.code=codes[i]);
  const b=ctx.calcLast100Model();
  a.rows.forEach((r,i)=>assert.equal(r.model,b.rows[i].model));
});
test('logout invalidates in-flight loads and clears refresh credentials',async()=>{
  const {ctx}=app(),pending=deferred(),data=rows(ctx,20);ctx.refreshTok='refresh';
  ctx.transport={list:()=>pending.promise};const loading=ctx.loadRounds();ctx.doLogout();pending.resolve(data);await loading;
  assert.equal(ctx.loadedDate,null);assert.equal(ctx.refreshTok,null);assert.equal(ctx.rounds.length,0);
});
test('EDIT opens and saves numeric database IDs passed as text by history buttons',async()=>{
  const {ctx,element}=app();ctx.rounds=rows(ctx,3);ctx.rounds[1].id=42;
  ctx.openEdit('42');
  assert.equal(element('modal').style.display,'flex');
  ctx.selCode('W');
  let calls=0;
  ctx.transport={request:async(path,init)=>{
    calls++;assert.match(path,/id=eq\.42$/);assert.equal(init.method,'PATCH');
    return {data:[{...ctx.rounds[1],code:'W'}]};
  }};
  await ctx.saveEdit();
  assert.equal(calls,1);assert.equal(ctx.rounds.length,3);assert.equal(ctx.rounds[1].code,'W');
});
test('CLR deletes numeric database IDs passed as text by history buttons',async()=>{
  const {ctx}=app();ctx.rounds=rows(ctx,3);ctx.rounds[1].id=42;
  let calls=0;
  ctx.transport={request:async(path,init)=>{
    calls++;assert.match(path,/id=eq\.42$/);assert.equal(init.method,'DELETE');
    return {data:[ctx.rounds[1]]};
  }};
  await ctx.clrRound('42');
  assert.equal(calls,1);assert.equal(ctx.rounds.length,2);assert.ok(ctx.rounds.every(r=>r.id!==42));
});
