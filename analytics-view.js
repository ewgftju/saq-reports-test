import {modules,regions} from './data.js';
import {comparisonChange} from './analytics-engine.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2});
const metrics=[
 {id:'count',label:'Количество записей',short:'Записи',unit:'ед.'},
 {id:'objectCount',label:'Уникальные объекты',short:'Объекты',unit:'ед.'},
 {id:'coverage',label:'Охвачено аудитом',short:'Охват аудитом',unit:'тыс. ₸'},
 {id:'financial',label:'Финансовые нарушения',short:'Нарушения',unit:'тыс. ₸'},
 {id:'restored',label:'Устранено нарушений',short:'Устраненная сумма',unit:'тыс. ₸'},
 {id:'elimination',label:'Доля устранения нарушений',short:'Доля устранения',unit:'%'}
];
const metricById=id=>metrics.find(metric=>metric.id===id)||metrics[0];
const numeric=value=>typeof value==='number'&&Number.isFinite(value);
const valueLabel=(value,id)=>numeric(value)?number.format(value)+(id==='elimination'?'%':''):'Нет данных';
const dateLabel=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?value.split('-').reverse().join('.'):'—';
const periodLabel=period=>`${dateLabel(period?.from)} — ${dateLabel(period?.to)}`;
const option=(value,label,current)=>`<option value="${esc(value)}"${value===current?' selected':''}>${esc(label)}</option>`;
const selectField=(label,key,values,current,empty)=>`<label class="field"><span>${label}</span><select data-filter="${key}">${option('',empty,current)}${values.map(value=>option(value,value,current)).join('')}</select></label>`;
const comparisonEnabled=(config,model)=>config.comparison.mode!=='none'&&!!model.comparisonPeriod;
const action=(label,name,kind='')=>`<button type="button" class="button ${kind}" data-action="${name}">${label}</button>`;

function deltaLabels(current,previous,id){
 const {absolute,percent}=comparisonChange(current,previous,{percentagePoints:id==='elimination'});
 const signed=value=>`${value>0?'+':''}${number.format(value)}`;
 return {
  absolute:numeric(absolute)?signed(absolute)+(id==='elimination'?' п.п.':''):'—',
  percent:numeric(percent)?signed(percent)+'%':'—'
 };
}

function controls(config,model,records){
 const {sources,filters,organs,comparison}=config;
 const statuses=[...new Set(records.filter(row=>sources.includes(row.module)).map(row=>row.status))].sort((a,b)=>a.localeCompare(b,'ru'));
 const availableOrgans=[...new Set(records.filter(row=>sources.includes(row.module)&&(!filters.region||row.region===filters.region)).map(row=>row.organ))].sort((a,b)=>a.localeCompare(b,'ru'));
 // Retain selected entries while filters change so a hidden selection can always be removed.
 const organOptions=[...new Set([...availableOrgans,...organs])];
 const comparisonPeriod=comparison.mode==='custom'?comparison:model.comparisonPeriod||{};
 return `<section class="panel analytics-sources"><div class="panel-body"><div class="source-checks" role="group" aria-label="Источники аналитики">${modules.map(module=>`<label class="source-choice ${sources.includes(module)?'checked':''}"><input type="checkbox" data-analytics-source="${esc(module)}"${sources.includes(module)?' checked':''}><span>${esc(module)}</span></label>`).join('')}</div></div></section>
 <section class="panel filters-panel analytics-filters"><div class="panel-head"><div><h3>Параметры сравнения</h3><p>Одинаковые источники и условия отбора применяются к обоим периодам.</p></div></div>
 <div class="panel-body"><div class="period-bar"><span class="small-text muted">Быстрый выбор основного периода</span><div class="chips">${[['month','Сентябрь 2026'],['quarter','III квартал 2026'],['year','2026 год']].map(([id,label])=>`<button type="button" class="chip" data-action="period" data-id="${id}">${label}</button>`).join('')}</div></div>
 <div class="analytics-period-grid"><fieldset class="analytics-period"><legend>Основной период</legend><div class="analytics-date-pair"><label class="field"><span>Период с</span><input aria-label="Период с" type="date" data-filter="from" value="${esc(filters.from)}"></label><label class="field"><span>Период по</span><input aria-label="Период по" type="date" data-filter="to" value="${esc(filters.to)}"></label></div></fieldset>
 <fieldset class="analytics-period"><legend>Период сравнения</legend><label class="field"><span class="visually-hidden">Режим сравнения</span><select id="analytics-comparison" aria-label="Режим сравнения">${option('previous-year','Аналогичный период прошлого года',comparison.mode)}${option('custom','Произвольный период',comparison.mode)}${option('none','Без сравнения',comparison.mode)}</select></label>${comparison.mode==='none'?'<p class="analytics-period-hint">Отображаются показатели основного периода.</p>':`<div class="analytics-date-pair"><label class="field"><span>Сравнить с</span><input aria-label="Сравнить с" type="date" data-comparison="from" value="${esc(comparisonPeriod.from||'')}"${comparison.mode==='previous-year'?' readonly':''}></label><label class="field"><span>Сравнить по</span><input aria-label="Сравнить по" type="date" data-comparison="to" value="${esc(comparisonPeriod.to||'')}"${comparison.mode==='previous-year'?' readonly':''}></label></div>`}</fieldset></div>
 <div class="analytics-other-filters">${selectField('Регион','region',regions,filters.region,'Все регионы')}${selectField('Статус','status',statuses,filters.status,'Все статусы')}<label class="field"><span>Объект, БИН или номер записи</span><input type="search" data-filter="query" value="${esc(filters.query)}" placeholder="Название или номер"></label></div>
 <details class="analytics-organs"${organs.length?' open':''}><summary>Органы аудита / ДВГА <span>${organs.length?`Выбрано: ${organs.length}`:'Все органы'}</span></summary><div class="analytics-organ-toolbar"><p>Выберите один или несколько органов для сравнения.</p>${action('Все органы','analytics-all-organs','small ghost')}</div><div class="analytics-organ-options">${organOptions.map(organ=>`<label class="checkbox-label"><input type="checkbox" data-analytics-organ="${esc(organ)}"${organs.includes(organ)?' checked':''}><span>${esc(organ)}${availableOrgans.includes(organ)?'':'<small>Нет в выбранных источниках и регионе</small>'}</span></label>`).join('')||'<p class="muted small-text">Нет органов для выбранных источников.</p>'}</div><p class="analytics-organ-hint">Если отдельные органы не выбраны, учитываются все доступные органы. ДВГА и СВА показаны отдельно.</p></details></div>
 <div class="panel-foot"><span class="small-text muted">Показатели обновляются при изменении параметров.</span><div class="actions">${action('Сбросить','reset-filters','ghost')}${action('Показать','generate-analytics','primary')}</div></div></section>`;
}

function summary(config,model){
 const compare=comparisonEnabled(config,model),{current,previous}=model.totals;
 const cards=['count','coverage','financial','elimination'].map(id=>{
  const metric=metricById(id),change=deltaLabels(current[id],previous?.[id],id);
  return `<article class="stat analytics-stat"><small>${metric.label}${metric.unit==='тыс. ₸'?', тыс. ₸':''}</small><strong>${valueLabel(current[id],id)}</strong>${compare?`<p>Период сравнения: <span>${valueLabel(previous?.[id],id)}</span></p><div class="analytics-delta">Изменение: <b>${change.absolute}${id==='elimination'||change.percent==='—'?'':` (${change.percent})`}</b></div>`:'<p>За основной период</p>'}</article>`;
 }).join('');
 return `<div class="analytics-period-labels"><span><i class="analytics-swatch current"></i>Основной: <b>${periodLabel(config.filters)}</b></span>${compare?`<span><i class="analytics-swatch previous"></i>Сравнение: <b>${periodLabel(model.comparisonPeriod)}</b></span>`:''}</div><div class="stats-grid analytics-stats">${cards}</div>`;
}

function metricTable(config,model){
 const compare=comparisonEnabled(config,model),{current,previous}=model.totals;
 return `<section class="panel analytics-metric-table"><div class="panel-head"><h3>Сводные показатели</h3><span class="small-text muted">По выбранным источникам и органам</span></div><div class="table-scroll"><table class="data-table"><thead><tr><th scope="col">Показатель</th><th scope="col" class="num">Основной период<br><span>${periodLabel(config.filters)}</span></th>${compare?`<th scope="col" class="num">Период сравнения<br><span>${periodLabel(model.comparisonPeriod)}</span></th><th scope="col" class="num">Разница</th><th scope="col" class="num">Изменение, %</th>`:''}</tr></thead><tbody>${metrics.map(metric=>{
  const change=deltaLabels(current[metric.id],previous?.[metric.id],metric.id);
  return `<tr><th scope="row">${metric.label}<small>${metric.unit}</small></th><td class="num">${valueLabel(current[metric.id],metric.id)}</td>${compare?`<td class="num">${valueLabel(previous?.[metric.id],metric.id)}</td><td class="num">${change.absolute}</td><td class="num">${metric.id==='elimination'?'<span title="Изменение доли показано в процентных пунктах в столбце «Разница»">—</span>':change.percent}</td>`:''}</tr>`;
 }).join('')}</tbody></table></div><div class="inline-note">Объекты считаются по уникальному БИН. Доля устранения = устраненная сумма / сумма, подлежащая устранению. ${compare?'Изменение доли — в п.п.; изменение в процентах не рассчитывается при нулевой базе или отсутствии данных.':''}</div></section>`;
}

function organComparison(config,model){
 const compare=comparisonEnabled(config,model),metric=metricById(config.metric),id=metric.id;
 const values=model.byOrgan.flatMap(row=>[row.current[id],...(compare?[row.previous?.[id]]:[])]).filter(numeric);
 const max=Math.max(1,...values);
 const bar=(value,period)=>`<div class="analytics-bar-line"><div class="analytics-bar-track" aria-hidden="true">${numeric(value)?`<div class="analytics-bar-fill ${period}" style="width:${Math.max(0,value)/max*100}%"></div>`:''}</div><span>${valueLabel(value,id)}</span></div>`;
 return `<section class="panel analytics-organ-comparison"><div class="panel-head"><div><h3>Сравнение органов аудита</h3><p>Выбранный показатель по каждому органу · ${metric.unit}</p></div><label class="field analytics-metric-select"><span>Показатель</span><select id="analytics-metric">${metrics.map(m=>option(m.id,m.label,id)).join('')}</select></label></div>
 ${model.byOrgan.length?`<div class="panel-body"><div class="analytics-chart-legend"><span><i class="analytics-swatch current"></i>${periodLabel(config.filters)}</span>${compare?`<span><i class="analytics-swatch previous"></i>${periodLabel(model.comparisonPeriod)}</span>`:''}</div><div class="analytics-paired-chart" role="img" aria-label="Сравнение органов аудита: ${metric.label}. Числовые значения приведены в следующей таблице.">${model.byOrgan.map(row=>`<div class="analytics-paired-row"><div class="analytics-organ-name">${esc(row.organ)}</div><div class="analytics-paired-bars">${bar(row.current[id],'current')}${compare?bar(row.previous?.[id],'previous'):''}</div></div>`).join('')}</div></div>
 <div class="table-scroll"><table class="data-table analytics-organ-table"><thead><tr><th scope="col">Орган аудита</th><th scope="col" class="num">Основной период<br>${periodLabel(config.filters)}</th>${compare?`<th scope="col" class="num">Период сравнения<br>${periodLabel(model.comparisonPeriod)}</th><th scope="col" class="num">Разница${id==='elimination'?', п.п.':''}</th><th scope="col" class="num">Изменение, %</th>`:''}</tr></thead><tbody>${model.byOrgan.map(row=>{
  const change=deltaLabels(row.current[id],row.previous?.[id],id);
  return `<tr><th scope="row">${esc(row.organ)}</th><td class="num">${valueLabel(row.current[id],id)}</td>${compare?`<td class="num">${valueLabel(row.previous?.[id],id)}</td><td class="num">${change.absolute}</td><td class="num">${change.percent}</td>`:''}</tr>`;
 }).join('')}</tbody></table></div>`:'<div class="empty"><h3>Нет органов для сравнения</h3><p>Измените источники, регион или период.</p></div>'}<div class="inline-note">Цвет обозначает период. Увеличение или уменьшение показателя само по себе не является оценкой работы органа.</div></section>`;
}

function moduleTable(config,model){
 return `<section class="panel analytics-modules"><div class="panel-head"><div><h3>Сравнение по модулям</h3><p>Основной период: ${periodLabel(config.filters)}. Нажмите на модуль для просмотра исходных записей.</p></div></div><div class="table-scroll"><table class="data-table"><thead><tr><th scope="col">Модуль</th><th scope="col" class="num">Записей</th><th scope="col" class="num">Объектов</th><th scope="col" class="num">Охват, тыс. ₸</th><th scope="col" class="num">Нарушения, тыс. ₸</th><th scope="col" class="num">Устранено, тыс. ₸</th></tr></thead><tbody>${model.byModule.map(row=>`<tr><th scope="row"><button type="button" class="row-link" data-action="analytics-drill" data-module="${esc(row.module)}">${esc(row.module)}</button></th>${['count','objectCount','coverage','financial','restored'].map(id=>`<td class="num">${valueLabel(row.current[id],id)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="inline-note">Количество объектов по модулям не суммируется: один БИН может встречаться в нескольких модулях. Финансовые показатели относятся к ВГА, СВА и ПРОФ.</div></section>`;
}

function monthlyDynamics(config,model){
 const counts=new Map();
 for(const row of model.currentRows){const month=row.date.slice(0,7);counts.set(month,(counts.get(month)||0)+1);}
 const months=[...counts.entries()].sort(([a],[b])=>a.localeCompare(b));
 const max=Math.max(1,...months.map(([,count])=>count));
 const label=month=>new Date(`${month}-01T00:00:00Z`).toLocaleString('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'});
 return `<details class="panel analytics-monthly"><summary>Динамика по месяцам <span>Количество записей · основной период</span></summary><div class="panel-body"><p class="small-text muted">${periodLabel(config.filters)} · по отчетной дате записи</p>${months.length?`<div class="analytics-month-list">${months.map(([month,count])=>`<div class="analytics-month-row"><span>${esc(label(month))}</span><div class="analytics-bar-track" aria-hidden="true"><div class="analytics-bar-fill current" style="width:${count/max*100}%"></div></div><strong>${number.format(count)}</strong></div>`).join('')}</div>`:'<p class="small-text muted">В основном периоде нет записей.</p>'}</div></details>`;
}

export function renderAnalytics(config,model,records){
 const form=controls(config,model,records);
 if(model.error)return form+`<section class="panel"><div class="panel-body"><p class="error" role="alert">${esc(model.error)}</p></div></section>`;
 const noRows=!model.currentRows.length&&!model.previousRows.length;
 const emptyNotice=noRows?'<div class="analytics-empty-note" role="status"><strong>Нет записей за выбранные периоды.</strong> Измените параметры. Отсутствующие денежные показатели не заменяются нулем.</div>':'';
 const unequal=config.comparison.mode==='custom'&&model.comparisonPeriod&&new Date(config.filters.to)-new Date(config.filters.from)!==new Date(model.comparisonPeriod.to)-new Date(model.comparisonPeriod.from)?'<div class="analytics-empty-note">Периоды имеют разную продолжительность. Учитывайте это при сравнении сумм и количества записей.</div>':'';
 return form+unequal+emptyNotice+summary(config,model)+metricTable(config,model)+organComparison(config,model)+monthlyDynamics(config,model)+moduleTable(config,model);
}
