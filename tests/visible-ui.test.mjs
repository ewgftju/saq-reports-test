import test from 'node:test';
import assert from 'node:assert/strict';
import {reportFeatures} from '../feature-flags.js';

// Production feature access and the two independent export paths.
test('simplified interface hides optional areas, preserves stored data and directly exports all columns',async()=>{
 assert.deepEqual(reportFeatures,{builder:false,saved:false,history:false,sources:false});
 const nodes=new Map(),listeners=new Map(),windowListeners=new Map();
 const saved=new Map([['saq.reports.templates.v1','[]'],['saq.reports.history.v1','[]']]);
 const writes=[],downloads=[];let currentBlob;
 const node=key=>{if(!nodes.has(key))nodes.set(key,{innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){}},setAttribute(){},showModal(){this.open=true;},close(){this.open=false;},select(){},remove(){this.innerHTML='';},scrollIntoView(){}});return nodes.get(key);};
 const createUrl=URL.createObjectURL,revokeUrl=URL.revokeObjectURL;URL.createObjectURL=blob=>{currentBlob=blob;return 'blob:test';};URL.revokeObjectURL=()=>{};
 global.document={createElement:()=>({click(){downloads.push({name:this.download,blob:currentBlob});}}),querySelector:node,addEventListener:(name,fn)=>listeners.set(name,fn)};
 global.window={scrollTo(){},addEventListener:(name,fn)=>windowListeners.set(name,fn),print(){}};
 global.location={hash:'#builder'};global.history={replaceState(_a,_b,url){location.hash=url;}};
 global.localStorage={getItem:key=>saved.get(key)||null,setItem:(key,value)=>{writes.push(key);saved.set(key,value);}};
 const timeout=global.setTimeout,timers=[];global.setTimeout=(fn,n)=>{const timer=timeout(fn,n);timer.unref();timers.push(timer);return timer;};
 const click=(action,other={})=>listeners.get('click')({target:{closest:()=>({dataset:{action,...other}})}});
 const change=(dataset,value,checked=false,id='')=>listeners.get('change')({target:{dataset,value,checked,id,type:'select-one'}});
 const page=()=>node('#page').innerHTML;
 try{
  await import('../app.js');
  assert.equal(location.hash,'#catalog');assert.match(page(),/Отчеты по управлениям/);
  assert.doesNotMatch(node('#app').innerHTML,/Конструктор отчетов|Мои шаблоны|История формирования|Источники данных/);
  assert.doesNotMatch(page(),/data-action="new-builder"/);
  for(const view of ['builder','saved','history','sources']){location.hash='#'+view;windowListeners.get('hashchange')();assert.equal(location.hash,'#catalog');}
  for(const action of ['new-builder','linked-example','to-builder','save-template','analytics-builder']){click(action);assert.match(page(),/Отчеты по управлениям/);}
  click('open-report',{id:'vga'});assert.doesNotMatch(page(),/В конструктор|Сохранить шаблон/);click('generate');
  assert.match(page(),/Выгрузить всё/);assert.match(page(),/Настроить выгрузку/);
  click('sort',{id:'id'});click('sort',{id:'id'});click('export-all');
  assert.equal(downloads.length,1);assert.match(downloads[0].name,/_form.xlsx$/);assert.notEqual(node('#dialog').open,true);
  const full=await downloads[0].blob.text();
  assert.match(full,/A1:IM30/); // All 247 columns and all 24 records, beyond the visible page.
  assert.ok(full.indexOf('VGA-2026-024')<full.indexOf('VGA-2026-001')); // Current sort is honored.
  click('configure-export');change({},'report',false,'export-scope');click('export-clear');change({exportColumn:'field:id'},'',true);click('download-selected-xlsx');
  assert.equal(downloads.length,2);assert.match(await downloads[1].blob.text(),/A1:A25/);
  click('close-dialog');click('export-all');assert.equal(downloads.length,3);assert.match(await downloads[2].blob.text(),/A1:IM30/);
  change({filter:'region'},'г. Астана');click('export-all');assert.equal(downloads.length,3);assert.match(page(),/Параметры изменены/);
  click('generate');click('export-all');assert.match(await downloads.at(-1).blob.text(),/A1:IM10/);
  click('open-report',{id:'sur'});click('generate');click('export-all');assert.match(await downloads.at(-1).blob.text(),/A1:F25/);
  click('navigate',{view:'analytics'});assert.doesNotMatch(page(),/data-action="analytics-builder"/);click('analytics-drill',{module:'СУР'});assert.equal(location.hash,'#report');assert.match(page(),/SUR-2026-001/);assert.doesNotMatch(page(),/В конструктор|Сохранить шаблон/);
  assert.ok(!writes.includes('saq.reports.history.v1'));assert.equal(saved.get('saq.reports.history.v1'),'[]');assert.equal(saved.get('saq.reports.templates.v1'),'[]');
 } finally{timers.forEach(clearTimeout);global.setTimeout=timeout;URL.createObjectURL=createUrl;URL.revokeObjectURL=revokeUrl;}
});
