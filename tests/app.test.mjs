import test from 'node:test';
import assert from 'node:assert/strict';

// Event-flow smoke tests with an isolated minimal DOM double; not a browser/layout test.
test('catalog, ready form, builder, template, history, analytics and stale result flows',async()=>{
 const nodes=new Map(),listeners=new Map(),saved=new Map();
 const node=key=>{if(!nodes.has(key))nodes.set(key,{innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){}},setAttribute(){},showModal(){this.open=true;},close(){this.open=false;},select(){},remove(){this.innerHTML='';},scrollIntoView(){}});return nodes.get(key);};
 global.document={querySelector:node,addEventListener:(name,fn)=>listeners.set(name,fn)};
 global.window={scrollTo(){},addEventListener(){},print(){}};
 global.location={hash:''};global.history={replaceState(){}};
 global.localStorage={getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)};
 const timers=[];const realTimeout=global.setTimeout;
 global.setTimeout=(fn,n)=>{const t=realTimeout(fn,n);t.unref();timers.push(t);return t;};
 const click=(action,other={})=>listeners.get('click')({target:{closest:()=>({dataset:{action,...other}})}});
 const change=(dataset,value,checked=false,id='')=>listeners.get('change')({target:{dataset,value,checked,id,type:'select-one'}});
 const page=()=>node('#page').innerHTML;
 await import('../app.js');assert.match(page(),/Готовые отчеты/);assert.match(page(),/Итоги в разрезе АБП/);
 click('open-report',{id:'vga'});click('generate');assert.match(page(),/Результат формирования/);assert.match(page(),/VGA-2026-001/);assert.match(page(),/Excel по форме/);
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
 timers.forEach(clearTimeout);global.setTimeout=realTimeout;
});
