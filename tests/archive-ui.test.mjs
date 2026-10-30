import test from 'node:test';
import assert from 'node:assert/strict';
import {archiveForms,formDepartment} from '../form-registry.js';
import {departmentTitle} from '../navigation.js';
import {colName} from '../export.js';

test('all archive forms generate from the catalog and export fully without opening field configuration',async()=>{
 const nodes=new Map(),listeners=new Map(),saved=new Map(),downloads=[];let currentBlob;
 const node=key=>{if(!nodes.has(key))nodes.set(key,{innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){}},setAttribute(){},showModal(){this.open=true;},close(){this.open=false;},select(){},remove(){this.innerHTML='';},scrollIntoView(){}});return nodes.get(key);};
 const createUrl=URL.createObjectURL,revokeUrl=URL.revokeObjectURL;URL.createObjectURL=blob=>{currentBlob=blob;return 'blob:test';};URL.revokeObjectURL=()=>{};
 global.document={createElement:()=>({click(){downloads.push({name:this.download,blob:currentBlob});}}),querySelector:node,addEventListener:(name,fn)=>listeners.set(name,fn)};
 global.window={scrollTo(){},addEventListener(){},print(){}};
 global.location={hash:'#catalog'};global.history={replaceState(_a,_b,url){location.hash=url;}};
 global.localStorage={getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value)};
 const timeout=global.setTimeout,timers=[];global.setTimeout=(fn,n)=>{const timer=timeout(fn,n);timer.unref();timers.push(timer);return timer;};
 const click=(action,other={})=>listeners.get('click')({target:{closest:()=>({dataset:{action,...other}})}});
 const change=(dataset,value,checked=false,id='')=>listeners.get('change')({target:{dataset,value,checked,id,type:'select-one'}});
 const page=()=>node('#page').innerHTML;
 try{
  await import('../app.js');
  for(const form of archiveForms){
   const before=downloads.length;
   click('open-archive',{id:form.id});assert.equal(location.hash,'#report');
   assert.ok(page().includes(departmentTitle(formDepartment(form))),form.id+' department breadcrumb');
   click('generate');assert.match(page(),/Результат формирования/,form.id);
   assert.doesNotMatch(page(),/role="alert"|Нужно уточнение/,form.id);
   assert.match(page(),/Выгрузить всё/);assert.match(page(),/Настроить выгрузку/);
   click('export-all');assert.equal(downloads.length,before+1,form.id);
   assert.notEqual(node('#dialog').open,true);
   const xml=await downloads.at(-1).blob.text();
   assert.equal((xml.match(/<sheet name=/g)||[]).length,form.sheets.length+1,form.id);
   assert.doesNotMatch(xml,/<pane |state="frozen"|#REF!|#DIV\/0!/,form.id);
   for(const sheet of form.sheets)assert.match(xml,new RegExp(`dimension ref="A1:${colName(sheet.columnCount)}\\d+"`),sheet.id);
  }
  // Selecting two columns from one sheet does not leak any of the other sheets.
  click('open-archive',{id:'uao-rating-criteria'});click('generate');click('configure-export');
  assert.match(node('#export-count').textContent,/Выбрано 76 из 76/);
  click('export-clear');assert.equal(node('#export-selected-xlsx').disabled,true);
  const rating=archiveForms.find(f=>f.id==='uao-rating-criteria');
  const last=rating.sheets.at(-1);change({exportColumn:`${last.id}:B`},'',true);change({exportColumn:`${last.id}:C`},'',true);
  click('download-selected-xlsx');const selected=await downloads.at(-1).blob.text();
  assert.equal((selected.match(/<sheet name=/g)||[]).length,2);
  assert.match(selected,/dimension ref="A1:B\d+"/);
  click('download-selected-csv');assert.match(downloads.at(-1).name,/_selected.csv$/);
  assert.doesNotMatch(await downloads.at(-1).blob.text(),/Максимальный балл|Государственный аудит/);
  click('close-dialog');click('export-all');const full=await downloads.at(-1).blob.text();
  assert.equal((full.match(/<sheet name=/g)||[]).length,5);
  // Changing report parameters blocks both export routes until regenerated.
  const before=downloads.length;change({filter:'region'},'г. Астана');click('export-all');
  assert.equal(downloads.length,before);assert.match(page(),/Параметры изменены/);
  click('configure-export');assert.notEqual(node('#dialog').open,true);
  click('generate');click('export-all');assert.equal(downloads.length,before+1);
  click('open-archive',{id:'uao-vga'});change({filter:'query'},'no-matching-case-xx');click('generate');
  assert.match(page(),/Нет записей за выбранный период/);click('export-all');
  assert.match(await downloads.at(-1).blob.text(),/dimension ref="A1:JJ6"/); // Empty result still exports its complete header.
 } finally{timers.forEach(clearTimeout);global.setTimeout=timeout;URL.createObjectURL=createUrl;URL.revokeObjectURL=revokeUrl;}
});
