import {departments,departmentReports,catalogReports,catalogGroups,catalogStatus,catalogStatusLabels,filterCatalog} from './catalog.js';
import {reports} from './data.js';
import {templates} from './templates.js';
import {templateMapping} from './engine.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const option=(id,label,current)=>`<option value="${esc(id)}" ${id===current?'selected':''}>${esc(label)}</option>`;
export function catalogControls({department,status,search}){
 return `<div class="catalog-controls"><label class="field catalog-department"><span>Управление</span><select id="catalog-department">${option('all','Все управления',department)}${catalogGroups.map(d=>option(d.id,`${d.number?d.number+'. ':''}${d.name} (${catalogReports.filter(r=>r.departmentId===d.id).length})`,department)).join('')}</select></label><label class="field catalog-search-field"><span>Поиск отчета</span><input type="search" id="catalog-search" placeholder="Название отчета или файла" value="${esc(search)}"></label><label class="field"><span>Доступность</span><select id="catalog-status">${option('all','Все отчеты',status)}${Object.entries(catalogStatusLabels).map(([id,label])=>option(id,label,status)).join('')}</select></label></div>`;
}
export function renderCatalogResults(filters){
 const list=filterCatalog(filters);
 const summary=`<div class="catalog-count" role="status">Найдено: <strong>${list.length}</strong><span>В перечне: ${departmentReports.length} позиции · ${departments.length} управлений</span><button type="button" class="button small ghost" data-action="catalog-reset">Показать все</button></div>`;
 if(!list.length)return summary+`<div class="empty"><h3>Отчеты не найдены</h3><p>Измените название, управление или доступность.</p></div>`;
 return summary+catalogGroups.map(d=>{
  const rows=list.filter(r=>r.departmentId===d.id);if(!rows.length)return '';
  return `<section class="department-section" aria-labelledby="department-${d.id}"><div class="department-heading"><h3 id="department-${d.id}">${d.number?`<span>${d.number}.</span> `:''}${esc(d.name)}</h3><span class="counter">${rows.length}</span></div>${d.id==='additional'?'<p class="catalog-extra-note">Эти отчеты не указаны в перечне заказчика. Управление пока не назначено.</p>':''}<table class="catalog-table"><thead><tr><th scope="col" class="catalog-number">№</th><th scope="col">Наименование отчета</th><th scope="col" class="catalog-state">Доступность</th><th scope="col" class="catalog-action"><span class="visually-hidden">Действие</span></th></tr></thead><tbody>${rows.map(r=>{
   const status=catalogStatus(r);
   return `<tr data-catalog-id="${r.id}"><td class="catalog-number">${r.number}</td><th scope="row"><button type="button" class="catalog-name" data-action="catalog-details" data-id="${r.id}">${esc(r.name)}</button>${r.revisionDiffers?'<small class="catalog-revision">Приложен образец другой редакции</small>':''}</th><td class="catalog-state"><span class="catalog-status ${status}">${catalogStatusLabels[status]}</span></td><td class="catalog-action"><button type="button" class="button small ${r.reportId?'':'ghost'}" data-action="${r.reportId?'open-report':'catalog-details'}" data-id="${r.reportId||r.id}" aria-label="${r.reportId?'Сформировать':'Подробнее'}: ${esc(r.name)}">${r.reportId?'Сформировать':'Подробнее'}</button></td></tr>`;
  }).join('')}</tbody></table></section>`;
 }).join('');
}
export function catalogDetail(id){
 const r=catalogReports.find(item=>item.id===id);if(!r)return null;
 const d=catalogGroups.find(item=>item.id===r.departmentId),report=reports.find(item=>item.id===r.reportId),t=templates.find(item=>item.id===report?.template);
 const status=catalogStatus(r),extra=d.id==='additional';
 const explanation=report?(t?`Доступна текущая форма на демонстрационных данных. Сопоставлены ${Object.keys(templateMapping(t.id)).length} из ${t.columnCount} колонок. При выгрузке можно выбрать нужные поля.`:'Доступен демонстрационный отчет по модулю. Рабочие данные еще не подключены.'):
  status==='form'?'Образец сопоставлен с перечнем. Автоматическое формирование этой формы пока не реализовано.':
  status==='reference'?'Приложено описание, но самой таблицы отчета в архиве нет. Для формирования нужна полная форма и подключение ее показателей.':
  status==='clarify'?'Названия в перечне повторяются. Чтобы реализовать отдельные формы, нужно уточнить их различия.':
  'Форма включена в перечень. В приложенном архиве ее образец отсутствует; автоматическое формирование пока не реализовано.';
 return {title:r.name,reportId:r.reportId,body:`<p class="small-text muted">${esc(d.name)}${extra?'':` · пункт ${r.number}`}</p><p><span class="catalog-status ${status}">${catalogStatusLabels[status]}</span></p><p>${explanation}</p>${r.note?`<p class="catalog-detail-note">${esc(r.note)}</p>`:''}${!extra?`<h4>Наименование в перечне</h4><p>${esc(r.sourceTitle)}</p>`:''}<h4>Материалы из архива</h4>${r.files.length?`<ul class="catalog-files">${r.files.map(file=>`<li>${esc(file)}</li>`).join('')}</ul><p class="small-text muted">Указаны файлы из архива «УАО.zip», по которым выполнено сопоставление.</p>`:'<p class="muted">Образец не приложен.</p>'}${!extra?'<p class="small-text muted">Источник распределения: «Список отчетов по управлениям.docx».</p>':''}`};
}
