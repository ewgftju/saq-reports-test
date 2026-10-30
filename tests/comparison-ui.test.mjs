import test from 'node:test';
import assert from 'node:assert/strict';
import {departments,catalogReports} from '../catalog.js';
import {analyticsRecords} from '../analytics-data.js';
import {modules} from '../data.js';
import {reportFeatures} from '../feature-flags.js';

// Real app event handlers and generated HTML with a small DOM double.
// These checks cover behavior and downloaded payloads, not browser layout.
let instance=0;
async function setup(t){
 const nodes=new Map(),listeners=new Map(),saved=new Map(),downloads=[];
 const node=key=>{
  if(!nodes.has(key))nodes.set(key,{innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){}},setAttribute(){},showModal(){this.open=true;},close(){this.open=false;},select(){},remove(){this.innerHTML='';},scrollIntoView(){}});
  return nodes.get(key);
 };
 const original={document:global.document,window:global.window,location:global.location,history:global.history,localStorage:global.localStorage,setTimeout:global.setTimeout,create:URL.createObjectURL,revoke:URL.revokeObjectURL,features:{...reportFeatures}};
 let downloadedBlob;
 const timers=[];
 URL.createObjectURL=blob=>{downloadedBlob=blob;return 'blob:comparison-test';};
 URL.revokeObjectURL=()=>{};
 global.document={querySelector:node,addEventListener:(name,fn)=>listeners.set(name,fn),createElement:()=>({click(){downloads.push({name:this.download,blob:downloadedBlob});}})};
 global.window={scrollTo(){},addEventListener(){},print(){}};
 global.location={hash:''};
 global.history={replaceState(_state,_unused,url){global.location.hash=url;}};
 global.localStorage={getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value)};
 global.setTimeout=(fn,delay)=>{const timer=original.setTimeout(fn,delay);timer.unref();timers.push(timer);return timer;};
 Object.keys(reportFeatures).forEach(key=>reportFeatures[key]=false);
 t.after(()=>{
  timers.forEach(clearTimeout);URL.createObjectURL=original.create;URL.revokeObjectURL=original.revoke;
  for(const key of ['document','window','location','history','localStorage','setTimeout'])global[key]=original[key];
  Object.assign(reportFeatures,original.features);
 });
 await import(`../app.js?comparison-test=${++instance}`);
 return {
  node,downloads,saved,
  page:()=>node('#page').innerHTML,
  shell:()=>node('#app').innerHTML,
  click:(action,other={})=>listeners.get('click')({target:{closest:()=>({dataset:{action,...other}})}}),
  change:(dataset,value,checked=false,id='',type='select-one')=>listeners.get('change')({target:{dataset,value,checked,id,type}}),
  input:(id,value,dataset={})=>listeners.get('input')({target:{id,value,dataset,type:'text'}})
 };
}

async function zipEntry(blob,wanted){
 const bytes=new Uint8Array(await blob.arrayBuffer()),view=new DataView(bytes.buffer),decode=new TextDecoder();
 for(let offset=0;offset+30<bytes.length&&view.getUint32(offset,true)===0x04034b50;){
  const size=view.getUint32(offset+18,true),nameSize=view.getUint16(offset+26,true),extraSize=view.getUint16(offset+28,true);
  const name=decode.decode(bytes.slice(offset+30,offset+30+nameSize)),start=offset+30+nameSize+extraSize;
  if(name===wanted)return decode.decode(bytes.slice(start,start+size));
  offset=start+size;
 }
 assert.fail(`Missing ZIP entry ${wanted}`);
}
const ids=text=>[...new Set(text.match(/VGA-2025-\d{3}/g)||[])].sort();

test('sidebar selects each of ten departments and all reports, clearing prior search and availability',async t=>{
 const ui=await setup(t);
 assert.doesNotMatch(ui.page(),/id="catalog-department"/);
 assert.equal((ui.shell().match(/class="department-nav-number"/g)||[]).length,10);
 for(const department of departments){
  ui.input('catalog-search','Точно отсутствующий отчет');
  ui.change({},'available',false,'catalog-status');
  ui.click('department',{id:department.id});
  assert.match(ui.page(),new RegExp(`id="department-${department.id}"`));
  assert.match(ui.page(),/id="catalog-search"[^>]*value=""/);
  assert.match(ui.page(),/value="all" selected>Все отчеты/);
  const visibleIds=[...ui.page().matchAll(/data-catalog-id="([^"]+)"/g)].map(match=>match[1]).sort();
  assert.deepEqual(visibleIds,catalogReports.filter(report=>report.departmentId===department.id).map(report=>report.id).sort());
  assert.match(ui.shell(),new RegExp(`data-id="${department.id}"[^>]*aria-current="page"`));
  assert.equal(JSON.parse(ui.saved.get('saq.reports.catalog.department.v1')),department.id);
 }
 ui.click('department',{id:'all'});
 assert.equal((ui.page().match(/data-catalog-id=/g)||[]).length,81);
 assert.match(ui.shell(),/data-id="all"[^>]*aria-current="page"/);
 ui.click('department',{id:'additional'});
 assert.equal((ui.page().match(/data-catalog-id=/g)||[]).length,4);
 ui.click('toggle-reports');assert.match(ui.shell(),/id="reports-menu" hidden/);
 ui.click('toggle-reports');assert.doesNotMatch(ui.shell(),/id="reports-menu" hidden/);
});

test('comparison events support custom periods, no comparison, validation and a complete reset',async t=>{
 const ui=await setup(t);
 ui.click('navigate',{view:'analytics'});
 assert.match(ui.page(),/data-comparison="from" value="2025-01-01" readonly/);
 ui.change({},'custom',false,'analytics-comparison');
 ui.change({comparison:'from'},'2025-07-01');
 ui.change({comparison:'to'},'2025-09-30');
 assert.match(ui.page(),/data-comparison="from" value="2025-07-01"/);
 assert.match(ui.page(),/Периоды имеют разную продолжительность/);
 assert.match(ui.page(),/01\.07\.2025 — 30\.09\.2025/);
 ui.change({comparison:'from'},'2025-12-01');
 ui.node('#toast').textContent='';ui.click('generate-analytics');
 assert.match(ui.page(),/role="alert">Начало периода сравнения не может быть позже окончания/);
 assert.doesNotMatch(ui.page(),/analytics-stats/);
 assert.equal(ui.node('#toast').textContent,'');
 ui.click('analytics-drill',{module:'ВГА'});
 assert.match(ui.page(),/role="alert"/);assert.doesNotMatch(ui.page(),/Результат формирования/);
 ui.change({},'none',false,'analytics-comparison');
 assert.doesNotMatch(ui.page(),/data-comparison=/);
 assert.doesNotMatch(ui.page(),/analytics-swatch previous/);
 assert.match(ui.page(),/analytics-stats/);
 ui.change({analyticsOrgan:'ДВГА · г. Астана'},'',true);
 ui.change({analyticsSource:'СВА'},'',false);
 ui.change({},'elimination',false,'analytics-metric');
 ui.change({filter:'query'},'9900');
 ui.click('reset-filters');
 assert.match(ui.page(),/value="previous-year" selected/);
 assert.match(ui.page(),/data-filter="from" value="2026-01-01"/);
 assert.match(ui.page(),/data-filter="query" value=""/);
 assert.equal((ui.page().match(/data-analytics-source="[^"]+" checked/g)||[]).length,5);
 assert.doesNotMatch(ui.page(),/data-analytics-organ="[^"]+" checked/);
 assert.match(ui.page(),/value="financial" selected/);
 ui.change({filter:'from'},'2024-02-29');ui.change({filter:'to'},'2024-03-31');
 assert.match(ui.page(),/data-comparison="from" value="2023-02-28" readonly/);
 ui.click('period',{id:'quarter'});
 assert.match(ui.page(),/data-comparison="from" value="2025-07-01" readonly/);
 assert.match(ui.page(),/data-filter="from" value="2026-07-01"/);
});

test('2025 multiple-organ drilldown preserves filters on regenerate and both export paths',async t=>{
 const ui=await setup(t),organs=['ДВГА · г. Астана','ДВГА · Карагандинская область'];
 ui.click('navigate',{view:'analytics'});
 for(const module of modules.filter(module=>module!=='ВГА'))ui.change({analyticsSource:module},'',false);
 ui.change({filter:'from'},'2025-01-01');ui.change({filter:'to'},'2025-09-30');
 for(const organ of organs)ui.change({analyticsOrgan:organ},'',true);
 ui.change({filter:'status'},'Завершено');ui.change({filter:'query'},'9900');
 assert.match(ui.page(),/Выбрано: 2/);
 const expected=analyticsRecords.filter(row=>row.module==='ВГА'&&row.date>='2025-01-01'&&row.date<='2025-09-30'&&organs.includes(row.organ)&&row.status==='Завершено').map(row=>row.id).sort();
 assert.ok(expected.length>1);
 ui.click('analytics-drill',{module:'ВГА'});
 assert.match(ui.page(),/Исходные записи/);
 assert.deepEqual(ids(ui.page()),expected);
 assert.doesNotMatch(ui.page(),/VGA-2026-/);
 assert.match(ui.shell(),/data-view="analytics"[^>]*aria-current="page"/);
 ui.click('generate');assert.deepEqual(ids(ui.page()),expected);
 ui.click('export-all');
 const full=ui.downloads.at(-1);
 assert.match(full.name,/2025-01-01_2025-09-30/);
 assert.deepEqual(ids(await zipEntry(full.blob,'xl/worksheets/sheet1.xml')),expected);
 assert.doesNotMatch(await zipEntry(full.blob,'xl/workbook.xml'),/Параметры/);
 ui.click('configure-export');ui.click('download-selected-csv');
 assert.deepEqual(ids(await ui.downloads.at(-1).blob.text()),expected);
 ui.click('download-selected-xlsx');
 assert.deepEqual(ids(await zipEntry(ui.downloads.at(-1).blob,'xl/worksheets/sheet1.xml')),expected);
 ui.click('close-dialog');
 // Edited parameters invalidate an old export before blur; regenerate retains the organ scope.
 const downloaded=ui.downloads.length;
 ui.input('', '2025-04-01',{filter:'from'});ui.click('export-all');
 assert.equal(ui.downloads.length,downloaded);
 ui.change({filter:'from'},'2025-04-01');ui.click('generate');
 const narrowed=analyticsRecords.filter(row=>expected.includes(row.id)&&row.date>='2025-04-01').map(row=>row.id).sort();
 assert.deepEqual(ids(ui.page()),narrowed);
 ui.click('configure-export');ui.click('download-selected-csv');
 assert.deepEqual(ids(await ui.downloads.at(-1).blob.text()),narrowed);
 ui.click('close-dialog');ui.click('navigate',{view:'analytics'});
 assert.match(ui.page(),/data-filter="from" value="2025-01-01"/);
 assert.match(ui.page(),/Выбрано: 2/);
 ui.click('analytics-all-organs');ui.click('analytics-drill',{module:'ВГА'});ui.click('export-all');
 assert.doesNotMatch(await zipEntry(ui.downloads.at(-1).blob,'xl/workbook.xml'),/Параметры/);
});
