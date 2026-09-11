(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RoundCore = api;
})(typeof self !== 'undefined' ? self : globalThis, function() {
  'use strict';
  const CODES = ['T','K','O','L','C','S','G','W'];
  // Legacy observed rates are an assumption, not verified game probabilities.
  const weights = [20.6,17.8,18.1,18.8,9,7.2,5.6,3];
  const total = weights.reduce((a,b) => a+b, 0);
  const PRIOR = weights.map(x => x / total);
  const pick = p => p.indexOf(Math.max(...p));
  function validateRows(rows, date) {
    if (!Array.isArray(rows)) throw new Error('Invalid round response');
    const seen = new Set();
    return rows.map(r => {
      if (!r || !Number.isInteger(r.round_number) || r.round_number < 1 || r.round_number > 2600 ||
          (date && r.play_date !== date) || !/^[a-zA-Z0-9-]+$/.test(String(r.id)) ||
          (r.code !== null && r.code !== '' && !CODES.includes(r.code))) {
        throw new Error('Invalid round data; analysis paused');
      }
      if (seen.has(r.round_number)) throw new Error('Duplicate round numbers; resolve duplicates before analysis');
      seen.add(r.round_number);
      return {...r};
    }).sort((a,b) => a.round_number - b.round_number);
  }
  function contiguousTail(rows) {
    const f = rows.filter(r => CODES.includes(r.code));
    let start = f.length - 1;
    while (start > 0 && f[start].round_number === f[start-1].round_number + 1) start--;
    return f.slice(Math.max(0, start));
  }
  const fingerprint = rows => rows.map(r => r.round_number + ':' + r.code).join('|');
  function learner() {
    const history = [], counts = Array(8).fill(0), chains = [null, new Map(), new Map(), new Map()];
    function forecast() {
      const base = counts.map((c,i) => (c + 40*PRIOR[i])/(history.length+40));
      const mixture = Array(8).fill(0), blend = [0,.5,.3,.2];
      let support = 0;
      for (let order=1; order<=3; order++) {
        const row = history.length >= order ? chains[order].get(history.slice(-order).join(',')) : null;
        const n = row ? row.reduce((a,b)=>a+b,0) : 0;
        support += n;
        for (let i=0;i<8;i++) mixture[i] += blend[order] * ((row ? row[i] : 0)+8*base[i])/(n+8);
      }
      return {base, pattern:mixture, support};
    }
    function observe(code) {
      const x = CODES.indexOf(code);
      if (x < 0) throw new Error('Unknown outcome');
      for (let order=1;order<=3;order++) if (history.length>=order) {
        const key = history.slice(-order).join(',');
        if (!chains[order].has(key)) chains[order].set(key, Array(8).fill(0));
        chains[order].get(key)[x]++;
      }
      counts[x]++; history.push(code);
    }
    return {forecast, observe};
  }
  function distribution(seq) {
    const model=learner(); seq.forEach(model.observe); return model.forecast();
  }
  function evidence(gains, patternHits, baseHits) {
    const n=gains.length;
    if (n<100 || patternHits<=baseHits) return false;
    const mean=gains.reduce((a,b)=>a+b,0)/n;
    const variance=gains.reduce((a,b)=>a+(b-mean)**2,0)/(n-1);
    const half=Math.floor(n/2);
    return mean>Math.max(.01,2*Math.sqrt(variance/n)) &&
      gains.slice(0,half).reduce((a,b)=>a+b,0)>0 && gains.slice(half).reduce((a,b)=>a+b,0)>0;
  }
  function evaluate(seq) {
    const model=learner(), gains=[];
    let baseHits=0, patternHits=0, policyHits=0, baseLoss=0, patternLoss=0, policyLoss=0;
    // Evaluate the switching policy before observing each outcome. Every forecast
    // and every model choice uses only that round's prefix, never its label.
    seq.forEach((code, i) => {
      const f=model.forecast(), actual=CODES.indexOf(code);
      if (actual<0) throw new Error('Unknown outcome');
      if (i>=20) {
        const chosen=evidence(gains,patternHits,baseHits)?f.pattern:f.base;
        const bl=-Math.log(f.base[actual]), pl=-Math.log(f.pattern[actual]);
        policyHits+=Number(pick(chosen)===actual); policyLoss-=Math.log(chosen[actual]);
        baseHits+=Number(pick(f.base)===actual); patternHits+=Number(pick(f.pattern)===actual);
        baseLoss+=bl; patternLoss+=pl; gains.push(bl-pl);
      }
      model.observe(code);
    });
    const f=model.forecast(), edge=evidence(gains,patternHits,baseHits), n=gains.length;
    const probs=edge?f.pattern:f.base;
    return {n, edge, probs, pick:CODES[pick(probs)], basePick:CODES[pick(f.base)], support:f.support,
      baseHits, patternHits, policyHits, baseLoss:n?baseLoss/n:null,
      patternLoss:n?patternLoss/n:null, policyLoss:n?policyLoss/n:null};
  }
  function wilson(h,n) {
    if (!n) return [0,1];
    const z=1.96,p=h/n,d=1+z*z/n,c=(p+z*z/(2*n))/d;
    const m=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;
    return [Math.max(0,c-m),Math.min(1,c+m)];
  }
  const LCGS = [
    {name:'Numerical Recipes',a:1664525,c:1013904223,m:4294967296},
    {name:'glibc-style LCG',a:1103515245,c:12345,m:2147483648},
    {name:'Borland C++',a:22695477,c:1,m:4294967296},
    {name:'MINSTD',a:16807,c:0,m:2147483647},
    {name:'ZX81',a:75,c:74,m:65537}
  ];
  const LFSRS = [
    {name:'LFSR-8',bits:8,taps:[8,6,5,4]},
    {name:'LFSR-16',bits:16,taps:[16,15,13,4]},
    {name:'LFSR-12',bits:12,taps:[12,11,10,4]}
  ];
  function weightedIndex(v,m) {
    if (!Number.isFinite(v) || v<0 || v>=m) throw new Error('Invalid generator output');
    let sum=0;
    for(let i=0;i<8;i++){sum+=PRIOR[i];if(v/m<sum)return i;}
    return 7;
  }
  function lcgStep(x,p) {
    // 32-bit products exceed Number's 53-bit exact range. imul preserves
    // the low 32 bits required by power-of-two moduli.
    if(p.m===4294967296)return (Math.imul(p.a,x)+p.c)>>>0;
    if(p.m===2147483648)return (Math.imul(p.a,x)+p.c)&0x7fffffff;
    return (p.a*x+p.c)%p.m;
  }
  function xorStep(x) {x^=x<<13;x^=x>>>17;x^=x<<5;return x>>>0;}
  function lfsrStep(x,p) {
    let bit=0;for(const tap of p.taps)bit^=(x>>>(tap-1))&1;
    return ((x<<1)|bit)&((1<<p.bits)-1);
  }
  function generate(seed, algo, p, n) {
    const out=[];let x=seed>>>0;
    const m=algo==='lcg'?p.m:algo==='xor'?4294967296:1<<p.bits;
    for(let i=0;i<n;i++) {
      x=algo==='lcg'?lcgStep(x,p):algo==='xor'?xorStep(x):lfsrStep(x,p);
      out.push(weightedIndex(x,m));
    }
    return out;
  }
  function fitSeed(train,algo,p,range) {
    let bestSeed=1,bestHits=-1;
    const max=algo==='lfsr'?Math.min(range,(1<<p.bits)-1):Math.min(range,(p?p.m:4294967296)-1);
    for(let seed=1;seed<=max;seed++) {
      const predicted=generate(seed,algo,p,train.length);
      const hits=predicted.reduce((a,x,i)=>a+Number(x===train[i]),0);
      if(hits>bestHits){bestHits=hits;bestSeed=seed;}
    }
    return {seed:bestSeed,hits:bestHits,searched:max};
  }
  function seedExperiment(seq,algo,p,range=100000) {
    // The seed is the state immediately before this window, not the day's
    // original seed. Holdout outcomes never participate in fitting.
    const window=seq.slice(-80);
    if(window.length<40)throw new Error('Need 40 consecutive rounds (at least 20 train + 20 holdout)');
    const train=window.slice(0,-20),test=window.slice(-20);
    const fit=fitSeed(train,algo,p,range), generated=generate(fit.seed,algo,p,window.length+5);
    const held=generated.slice(train.length,window.length);
    const hits=held.reduce((a,x,i)=>a+Number(x===test[i]),0);
    const counts=Array(8).fill(0);train.forEach(x=>counts[x]++);
    const base=pick(counts),baselineHits=test.filter(x=>x===base).length;
    return {...fit,trainN:train.length,testN:test.length,testHits:hits,baselineHits,
      exact:fit.hits===train.length&&hits===test.length,
      next:generated.slice(window.length).map(x=>CODES[x])};
  }
  return {CODES,PRIOR,pick,validateRows,contiguousTail,fingerprint,learner,distribution,evaluate,wilson,
    LCGS,LFSRS,weightedIndex,lcgStep,xorStep,lfsrStep,generate,fitSeed,seedExperiment};
});
