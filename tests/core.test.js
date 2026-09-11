'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../prediction-core');
test('LCGs agree with exact BigInt arithmetic, including overflowing products',()=>{
  for(const p of C.LCGS)for(const seed of [1,1234567,p.m-1]){
    let x=seed,oracle=BigInt(seed);
    for(let i=0;i<100;i++){
      x=C.lcgStep(x,p);oracle=(BigInt(p.a)*oracle+BigInt(p.c))%BigInt(p.m);
      assert.equal(x,Number(oracle));
    }
  }
});
test('xorshift32 uses unsigned right shifts and known sequence',()=>{
  let x=1;
  for(const expected of [270369,67634689,2647435461,307599695,2398689233]){
    x=C.xorStep(x);assert.equal(x,expected);
  }
});
test('LFSR taps produce full nonzero periods in the selected shift convention',()=>{
  for(const p of C.LFSRS){
    let x=1,count=0;do{x=C.lfsrStep(x,p);assert.notEqual(x,0);count++;}while(x!==1&&count<=1<<p.bits);
    assert.equal(count,(1<<p.bits)-1);
  }
});
test('weights normalize and bucket boundaries use half-open intervals',()=>{
  assert.ok(Math.abs(C.PRIOR.reduce((a,b)=>a+b,0)-1)<1e-12);
  assert.equal(C.weightedIndex(0,1),0);
  assert.equal(C.weightedIndex(C.PRIOR[0],1),1);
  assert.equal(C.weightedIndex(0.999999,1),7);
  assert.throws(()=>C.weightedIndex(1,1));
});
test('seed forecast advances from fitted window, even with more than 80 rounds',()=>{
  const p=C.LCGS[0],series=C.generate(17,'lcg',p,85);
  const seq=Array(70).fill(7).concat(series.slice(0,80));
  const r=C.seedExperiment(seq,'lcg',p,30);
  assert.equal(r.seed,17);assert.equal(r.hits,60);assert.equal(r.testHits,20);
  assert.deepEqual(r.next,series.slice(80).map(x=>C.CODES[x]));assert.equal(r.exact,true);
});
test('altering holdout labels cannot change fitted seed or candidate continuation',()=>{
  const p=C.LCGS[0],seq=C.generate(17,'lcg',p,80);
  const a=C.seedExperiment(seq,'lcg',p,30);
  const b=C.seedExperiment(seq.slice(0,60).concat(seq.slice(60).map(x=>(x+1)%8)),'lcg',p,30);
  assert.equal(a.seed,b.seed);assert.deepEqual(a.next,b.next);assert.equal(b.testHits,0);
});
test('seed search does not repeat equivalent LFSR seeds',()=>{
  assert.equal(C.fitSeed([1,2,3],'lfsr',C.LFSRS[0],3000).searched,255);
  assert.throws(()=>C.seedExperiment([1,2,3],'xor',null,10),/40 consecutive/);
});
test('walk-forward loss scores an unseen outcome using prefix-only probabilities',()=>{
  const prefix='TKOLCSGWTKOLCSGWTKOL'.split(''),f=C.distribution(prefix);
  for(let i=0;i<8;i++){
    const r=C.evaluate(prefix.concat(C.CODES[i]));assert.equal(r.n,1);
    assert.ok(Math.abs(r.baseLoss+Math.log(f.base[i]))<1e-12);
    assert.ok(Math.abs(r.patternLoss+Math.log(f.pattern[i]))<1e-12);
    assert.equal(r.policyHits,Number(C.pick(f.base)===i));
  }
});
test('smoothing prevents 100% confidence on small repeated samples; abstains without evidence',()=>{
  const r=C.evaluate(Array(25).fill('T'));
  assert.equal(r.edge,false);assert.ok(r.probs.every(p=>p>0&&p<1));
  assert.ok(Math.abs(r.probs.reduce((a,b)=>a+b,0)-1)<1e-12);
  assert.equal(C.evaluate([]).edge,false);
});
test('deterministic alternating signal can qualify while weighted synthetic noise does not',()=>{
  assert.equal(C.evaluate(Array.from({length:600},(_,i)=>i%2?'K':'T')).edge,true);
  const noise=C.generate(38456,'lcg',C.LCGS[0],1500).map(x=>C.CODES[x]);
  assert.equal(C.evaluate(noise).edge,false);
});
test('duplicate, invalid or cross-date data fail closed; gaps break sequence',()=>{
  const row=(n,code='T')=>({id:'id-'+n,round_number:n,code,play_date:'2026-09-11'});
  assert.deepEqual(C.contiguousTail([row(1),row(2),row(4),row(5)]).map(r=>r.round_number),[4,5]);
  assert.deepEqual(C.contiguousTail([row(1),row(2,''),row(3)]).map(r=>r.round_number),[3]);
  assert.throws(()=>C.validateRows([row(1),row(1)],'2026-09-11'),/Duplicate/);
  for(const bad of [row(0),row(1.5),row(2601),row(1,'X')])assert.throws(()=>C.validateRows([bad]));
  assert.throws(()=>C.validateRows([row(1)],'2026-09-12'));
});
