'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../widgets/wallbox-status/public/widget-core.js');
const base = { chargeState: '2', chargePower: 7400, chargeEnergy: 12.6, paused: false, connectionError: false, stale: false, lastUpdated: 1790514000000 };
test('charging maps watts to kW and preserves session kWh', () => {
 const m = core.normalizeStatus(base); assert.equal(m.state,'charging'); assert.equal(m.power,7.4); assert.equal(m.energy,12.6); assert.equal(m.action,'pause');
});
test('disconnected wins over paused: an unplugged car is not a paused session', () => {
 const m=core.normalizeStatus({...base,chargeState:'0',paused:true}); assert.equal(m.state,'waiting'); assert.equal(m.presence,'idle'); assert.equal(m.action,null);
});
test('connected and permitted is ready, not guaranteed to start',()=>{
 const m=core.normalizeStatus({...base,chargeState:1,chargePower:0}); assert.equal(m.state,'ready'); assert.equal(m.action,'pause');
});
test('paused requires no invented session record',()=>{
 const m=core.normalizeStatus({...base,chargeState:'1',paused:true,chargeEnergy:null}); assert.equal(m.state,'paused'); assert.equal(m.energy,null); assert.equal(m.action,'resume');
});
test('connection error overrides stale power and all product states',()=>{
 const m=core.normalizeStatus({...base,connectionError:true}); assert.equal(m.state,'offline'); assert.equal(m.power,null); assert.equal(m.energy,null); assert.equal(m.action,'refresh');
});
test('missing payload and unknown state never become no-car or charging',()=>{
 for (const x of [null,{}, {...base,chargeState:null},{...base,chargeState:'surprise'}]) assert.equal(core.normalizeStatus(x).state,'unknown');
});
test('null, booleans, whitespace and nonfinite metrics are not zero',()=>{
 for(const x of [null,undefined,'', ' ',true,NaN,Infinity,-1]){const m=core.normalizeStatus({...base,chargePower:x,chargeEnergy:x});assert.equal(m.power,null);assert.equal(m.energy,null);}
});
test('finite numeric strings are supported, zero is valid',()=>{
 const m=core.normalizeStatus({...base,chargePower:'0',chargeEnergy:'12.6'});assert.equal(m.power,0);assert.equal(m.energy,12.6);
});
test('unknown control flags disable controls rather than coercing strings',()=>{
 for (const paused of [null,undefined,'false','0']) assert.equal(core.normalizeStatus({...base,paused}).state,'unknown');
});
test('missing error flag is treated as unknown telemetry',()=>{assert.equal(core.normalizeStatus({...base,connectionError:null}).state,'unknown');});
test('display numbers have one decimal and no undefined or NaN',()=>{
 assert.equal(core.formatMetric(null),'—'); assert.equal(core.formatMetric(7.4),'7.4'); assert.equal(core.formatMetric(12.6,'cs'),'12,6');
});
test('explicit pause is idempotent if another interface already paused',()=>{
 assert.equal(core.commandFor('pause', core.normalizeStatus({...base,paused:true})),null);
 assert.deepEqual(core.commandFor('pause',core.normalizeStatus(base)),{paused:true});
});
test('resume enables charging; the UI must await telemetry to claim charging',()=>{
 assert.deepEqual(core.commandFor('resume',core.normalizeStatus({...base,paused:true})),{paused:false});
 assert.equal(core.commandFor('resume',core.normalizeStatus({...base,chargeState:'1'})),null);
});
test('stale actions cannot control a disconnected or offline device',()=>{
 for (const m of [core.normalizeStatus({...base,connectionError:true}),core.normalizeStatus({...base,chargeState:'0'})]) assert.throws(()=>core.commandFor('pause',m),/unavailable/);
});
test('refresh never returns a POST payload',()=>{assert.equal(core.commandFor('refresh',core.normalizeStatus(base)),null);});
