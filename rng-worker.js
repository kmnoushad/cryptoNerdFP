'use strict';
importScripts('prediction-core.js');
self.onmessage = function(event) {
  try {
    const seq=event.data.seq;
    if(!Array.isArray(seq)||seq.some(x=>!Number.isInteger(x)||x<0||x>7))throw new Error('Invalid sequence');
    const jobs=RoundCore.LCGS.map(p=>({algo:'lcg',p,name:p.name,range:100000}))
      .concat([{algo:'xor',p:null,name:'XorShift32',range:100000}])
      .concat(RoundCore.LFSRS.map(p=>({algo:'lfsr',p,name:p.name,range:(1<<p.bits)-1})));
    const results=[];
    jobs.forEach((job,i)=>{
      self.postMessage({progress:Math.round(i/jobs.length*100),name:job.name});
      results.push({name:job.name,...RoundCore.seedExperiment(seq,job.algo,job.p,job.range)});
    });
    self.postMessage({results});
  } catch(error) {self.postMessage({error:error.message});}
};
