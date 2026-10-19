import test from 'node:test';
import assert from 'node:assert/strict';
import {records,modules,defaultFilters} from '../data.js';
import {availableFields,generate,validate,normalizeBuilderConfig,linkedSources} from '../engine.js';
const config=(overrides={})=>({name:'Test',dataset:'module',sources:['ВГА'],filters:defaultFilters(),group:'none',columns:['id','financial'],...overrides});

test('one-module report cannot select a second module or a foreign field/filter',()=>{
 for(const change of [{sources:['ВГА','СУР']},{columns:['id','risk']},{filters:{...defaultFilters(),risk:'Высокий'}},{columns:['id','id']},{sources:['ВГА','ВГА']},{sources:['unknown']},{dataset:'anything'},{group:'bin'},{group:'region',columns:['count']},{sources:['СУР'],columns:['id'],template:'vga'}]){
  assert.throws(()=>generate(records,config(change)),undefined,JSON.stringify(change));
 }
 for(const source of modules){const c=config({sources:[source]});c.columns=availableFields(c.sources,c.group,c.dataset).map(f=>f.id);assert.equal(validate(c),'');assert.equal(generate(records,c).recordCount,24);}
});

test('common registry exposes only common fields and counters for every module combination',()=>{
 for(let mask=1;mask<1<<modules.length;mask++){
  const sources=modules.filter((m,i)=>mask&(1<<i));
  for(const group of ['none','module','region','organ','month']){
   const columns=availableFields(sources,group,'registry').map(f=>f.id);
   assert.ok(!columns.some(f=>['financial','coverage','restored','risk','score','decision','deadline'].includes(f)));
   if(group!=='none')assert.deepEqual(new Set(columns),new Set([group,'count','objectCount']));
   const result=generate(records,config({dataset:'registry',sources,group,columns}));assert.equal(result.recordCount,sources.length*24);
  }
 }
 for(const change of [{columns:['id','financial']},{columns:['id','risk']},{template:'vga',columns:['id']},{columns:['id'],filters:{...defaultFilters(),minFinancial:'0'}}])assert.throws(()=>generate(records,config({dataset:'registry',sources:['ВГА','СУР'],...change})));
});

test('linked set locks sources and supported columns, grouping and filters',()=>{
 const c=config({dataset:'case-links',sources:[...linkedSources],columns:['id','risk','financial','balance']});
 const r=generate(records,c);assert.equal(r.recordCount,3);assert.equal(r.rows[0].balance,800);
 for(const change of [{sources:['ВГА','СВА','СУР','Возражения']},{sources:['ВГА','СУР']},{group:'module',columns:['module','count']},{columns:['id','decision']},{template:'vga'},{filters:{...defaultFilters(),status:'Завершено'}}])assert.throws(()=>generate(records,{...c,...change}));
});

test('legacy mixed templates remove incompatible fields and filters without mutating originals',()=>{
 const old=config({dataset:undefined,sources:['ВГА','СУР'],columns:['id','financial','risk'],filters:{...defaultFilters(),risk:'Высокий'}}),copy=structuredClone(old);
 const next=normalizeBuilderConfig(old);assert.deepEqual(old,copy);assert.equal(next.dataset,'registry');assert.deepEqual(next.columns,['id']);assert.equal(next.filters.risk,'');assert.equal(generate(records,next).recordCount,48);
 const linked=normalizeBuilderConfig(config({dataset:'case-links',sources:['ВГА'],group:'module',columns:['module','financial']}));assert.deepEqual(linked.sources,linkedSources);assert.equal(linked.group,'none');assert.equal(validate(linked),'');
 const grouped=normalizeBuilderConfig(config({dataset:'registry',sources:['ВГА','СУР'],group:'region',columns:['financial']}));assert.deepEqual(grouped.columns,['region']);assert.equal(validate(grouped),'');
});
