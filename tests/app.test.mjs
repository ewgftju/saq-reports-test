import test from 'node:test';
import assert from 'node:assert/strict';

// Event-flow smoke tests with an isolated minimal DOM double; not a browser/layout test.
test('catalog, ready form, builder, template, history, analytics and stale result flows',async()=>{
 const nodes=new Map(),listeners=new Map(),saved=new Map();
 const node=key=>{if(!nodes.has(key))nodes.set(key,{innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){}},setAttribute(){},showModal(){this.open=true;},close(){this.open=false;},select(){},remove(){this.innerHTML='';},scrollIntoView(){}});return nodes.get(key);};
 const downloads=[];let downloadedBlob;const oldCreateURL=URL.createObjectURL,oldRevokeURL=URL.revokeObjectURL;URL.createObjectURL=blob=>{downloadedBlob=blob;return 'blob:test';};URL.revokeObjectURL=()=>{};
 global.document={createElement:()=>({click(){downloads.push({name:this.download,blob:downloadedBlob});}}),querySelector:node,addEventListener:(name,fn)=>listeners.set(name,fn)};
 global.window={scrollTo(){},addEventListener(){},print(){}};
 global.location={hash:''};global.history={replaceState(){}};
 global.localStorage={getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)};
 const timers=[];const realTimeout=global.setTimeout;
 global.setTimeout=(fn,n)=>{const t=realTimeout(fn,n);t.unref();timers.push(t);return t;};
 const click=(action,other={})=>listeners.get('click')({target:{closest:()=>({dataset:{action,...other}})}});
 const change=(dataset,value,checked=false,id='')=>listeners.get('change')({target:{dataset,value,checked,id,type:'select-one'}});
 const input=(id,value)=>listeners.get('input')({target:{id,value,dataset:{}}});
 const page=()=>node('#page').innerHTML;
 await import('../app.js');assert.match(page(),/Готовые отчеты/);assert.match(page(),/Итоги в разрезе АБП/);
 click('open-report',{id:'vga'});click('generate');assert.match(page(),/Результат формирования/);assert.match(page(),/VGA-2026-001/);assert.match(page(),/Настроить выгрузку/);

 click('configure-export');assert.match(node('#dialog').innerHTML,/Все поля исходной формы \(246\)/);assert.match(node('#export-count').textContent,/Выбрано 18 из 246/);
 click('export-clear');assert.equal(node('#export-selected-xlsx').disabled,true);click('download-selected-xlsx');assert.equal(downloads.length,0);
 change({exportColumn:'form:C'},'',true);change({exportColumn:'form:V'},'',true);assert.equal(node('#export-selected-xlsx').disabled,false);
 input('export-search','БИН');assert.match(node('#export-options').innerHTML,/form:N/);assert.doesNotMatch(node('#export-options').innerHTML,/form:C/);
 click('export-select-visible');assert.match(node('#export-count').textContent,/Выбрано 3 из 246/);click('export-unselect-visible');assert.match(node('#export-count').textContent,/Выбрано 2 из 246/);
 input('export-search','');change({},'',true,'export-selected-only');assert.match(node('#export-options').innerHTML,/form:C/);assert.match(node('#export-options').innerHTML,/form:V/);assert.doesNotMatch(node('#export-options').innerHTML,/form:N/);
 change({},'report',false,'export-scope');change({},'form',false,'export-scope');assert.match(node('#export-count').textContent,/Выбрано 2 из 246/);click('download-selected-xlsx');assert.equal(downloads.length,1);assert.match(downloads[0].name,/_selected.xlsx$/);assert.ok((await downloads[0].blob.arrayBuffer()).byteLength>1000);assert.ok(saved.has('saq.reports.exports.v1'));
 click('close-dialog');click('configure-export');assert.match(node('#export-count').textContent,/Выбрано 2 из 246/);
 change({},'report',false,'export-scope');assert.match(node('#export-count').textContent,/Выбрано 7 из 7/);assert.doesNotMatch(node('#export-options').innerHTML,/form:/);click('close-dialog');
 change({filter:'region'},'г. Астана');assert.match(page(),/Параметры изменены/);click('generate');assert.match(page(),/Строк отчета: <b>4/);
 click('preview-tab',{id:'original'});assert.match(page(),/247 колонок/);click('preview-tab',{id:'schema'});assert.match(page(),/Источник не подключен/);
 click('new-builder');assert.match(page(),/type="radio"/);change({source:'Возражения'},'',true);assert.doesNotMatch(page(),/data-field="financial"/);change({},'module',false,'group-select');click('generate');assert.match(page(),/Результат формирования/);assert.match(page(),/Возражения/);
 click('save-template');node('#template-name').value='Мой отчет';click('confirm-save');assert.ok(saved.has('saq.reports.templates.v1'));
 click('navigate',{view:'saved'});assert.match(page(),/Мой отчет/);const template=JSON.parse(saved.get('saq.reports.templates.v1'))[0];click('load-template',{id:template.savedId});click('generate');assert.match(page(),/Мой отчет/);
 click('navigate',{view:'history'});assert.match(page(),/История формирования/);const snapshot=JSON.parse(saved.get('saq.reports.history.v1'))[0];click('open-history',{id:snapshot.historyId});assert.match(page(),/Результат формирования/);
 click('navigate',{view:'analytics'});assert.match(page(),/Сравнение по модулям/);click('analytics-drill',{module:'СУР'});assert.match(page(),/Балл риска/);assert.match(page(),/SUR-2026-001/);
 change({filter:'from'},'2026-12-01');change({filter:'to'},'2026-01-01');click('generate');assert.match(page(),/Начало периода не может быть позже окончания/);
 click('navigate',{view:'sources'});assert.match(page(),/Рабочие данные не подключены/);
 click('linked-example');assert.match(page(),/VGA-LINK-001/);assert.match(page(),/Не устранено на дату/);click('details',{index:'0'});assert.match(node('#dialog').innerHTML,/PAY-003/);assert.match(node('#dialog').innerHTML,/CANCEL-001/);click('close-dialog');
 click('configure-export');change({exportColumn:'field:risk'},'',false);change({exportColumn:'field:assessmentId'},'',false);click('download-selected-csv');const linkedCsv=await downloads.at(-1).blob.text();assert.doesNotMatch(linkedCsv,/Уровень риска|Связанный расчёт СУР|RISK-001/);assert.match(linkedCsv,/Возражения, кол-во/);assert.match(linkedCsv,/VGA-LINK-001/);assert.match(linkedCsv,/"200";"800"/);click('close-dialog');
 click('save-template');node('#template-name').value='Связанный шаблон';click('confirm-save');const linked=JSON.parse(saved.get('saq.reports.templates.v1'))[0];assert.equal(linked.dataset,'case-links');click('new-builder');click('load-template',{id:linked.savedId});click('generate');assert.match(page(),/VGA-LINK-002/);

 // Arbitrary source combinations are available only in the common registry.
 click('new-builder');change({},'registry',false,'dataset-select');change({source:'СУР'},'',true);click('all-fields');
 assert.doesNotMatch(page(),/data-field="(financial|risk|decision|score)"/);click('generate');assert.match(page(),/Записей: <b>48/);change({},'month',false,'group-select');click('all-fields');assert.match(page(),/1. Месяц/);click('move-field',{id:'month',dir:'1'});assert.match(page(),/1. Месяц/);
 change({},'module',false,'dataset-select');assert.doesNotMatch(page(),/Результат формирования/);change({source:'СУР'},'',true);
 change({filter:'risk'},'Высокий');change({source:'ВГА'},'',true);click('generate');assert.match(page(),/Записей: <b>24/);
 change({},'case-links',false,'dataset-select');assert.doesNotMatch(page(),/data-source=/);assert.doesNotMatch(page(),/value="module"[^>]*>По модулям/);click('generate');assert.match(page(),/Записей: <b>3/);
 click('navigate',{view:'analytics'});assert.match(page(),/Сравнение по модулям/);click('analytics-builder');assert.match(page(),/Результат формирования/);assert.doesNotMatch(page(),/data-field="financial"/);
 // Legacy entries are kept but incompatible settings cannot restore/export their stale result.
 const legacy=JSON.parse(saved.get('saq.reports.templates.v1'))[0];legacy.dataset=undefined;legacy.sources=['ВГА','СУР'];legacy.columns=['id','financial','risk'];legacy.filters.risk='Высокий';legacy.savedId='legacy';
 // Persisted entries are injected through a fresh app instance to exercise the actual read path.
 saved.set('saq.reports.templates.v1',JSON.stringify([legacy]));
 const oldSnapshot={...snapshot,historyId:'legacy-history',config:{...legacy},columns:legacy.columns};saved.set('saq.reports.history.v1',JSON.stringify([oldSnapshot]));
 await import('../app.js?legacy');click('load-template',{id:'legacy'});assert.match(page(),/Настройки приведены/);assert.doesNotMatch(page(),/data-field="(financial|risk)"/);click('generate');assert.match(page(),/Записей: <b>48/);
 click('open-history',{id:'legacy-history'});assert.match(page(),/Настройки приведены/);assert.doesNotMatch(page(),/Результат формирования/);
 click('download-history',{id:'legacy-history'});assert.match(page(),/Настройки приведены/);
 timers.forEach(clearTimeout);global.setTimeout=realTimeout;URL.createObjectURL=oldCreateURL;URL.revokeObjectURL=oldRevokeURL;
});
