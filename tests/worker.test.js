'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const C=require('../prediction-core');
const script=fs.readFileSync(path.join(__dirname,'../rng-worker.js'),'utf8');
test('actual worker entry point completes all nine experiments with holdout metrics',()=>{
  const messages=[],context={RoundCore:C,importScripts:name=>assert.equal(name,'prediction-core.js'),self:{postMessage:m=>messages.push(m)}};
  vm.createContext(context);vm.runInContext(script,context);
  context.self.onmessage({data:{seq:C.generate(17,'lcg',C.LCGS[0],80)}});
  const final=messages.at(-1);assert.equal(final.results.length,9);
  assert.equal(final.results[0].exact,true);
  assert.ok(final.results.every(r=>r.testN===20&&r.trainN===60));
  assert.equal(messages.filter(m=>m.progress!==undefined).length,9);
});
test('worker reports invalid input as an error message',()=>{
  const messages=[],context={RoundCore:C,importScripts(){},self:{postMessage:m=>messages.push(m)}};
  vm.createContext(context);vm.runInContext(script,context);
  context.self.onmessage({data:{seq:[0,8]}});assert.match(messages[0].error,/Invalid/);
});
