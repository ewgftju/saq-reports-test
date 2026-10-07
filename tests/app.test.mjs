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
 click('new-builder');change({source:'Возражения'},'',true);change({},'module',false,'group-select');click('generate');assert.match(page(),/Результат формирования/);assert.match(page(),/Возражения/);
 click('save-template');node('#template-name').value='Мой отчет';click('confirm-save');assert.ok(saved.has('saq.reports.templates.v1'));
 click('navigate',{view:'saved'});assert.match(page(),/Мой отчет/);const template=JSON.parse(saved.get('saq.reports.templates.v1'))[0];click('load-template',{id:template.savedId});click('generate');assert.match(page(),/Мой отчет/);
 click('navigate',{view:'history'});assert.match(page(),/История формирования/);const snapshot=JSON.parse(saved.get('saq.reports.history.v1'))[0];click('open-history',{id:snapshot.historyId});assert.match(page(),/Результат формирования/);
 click('navigate',{view:'analytics'});assert.match(page(),/Сравнение по модулям/);click('analytics-drill',{module:'СУР'});assert.match(page(),/Балл риска/);assert.match(page(),/SUR-2026-001/);
 change({filter:'from'},'2026-12-01');change({filter:'to'},'2026-01-01');click('generate');assert.match(page(),/Начало периода не может быть позже окончания/);
 click('navigate',{view:'sources'});assert.match(page(),/Рабочие данные не подключены/);
 timers.forEach(clearTimeout);global.setTimeout=realTimeout;
});
