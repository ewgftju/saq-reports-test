import {departments,catalogReports,catalogGroups,catalogStatusLabels,filterCatalog} from './catalog.js';
import {archiveForms} from './archive-schemas.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const option=(id,label,current)=>`<option value="${esc(id)}" ${id===current?'selected':''}>${esc(label)}</option>`;
export function catalogControls({department,status,search}){
 return `<div class="catalog-controls"><label class="field catalog-search-field"><span>Поиск отчета</span><input type="search" id="catalog-search" placeholder="Название отчета или файла" value="${esc(search)}"></label><label class="field"><span>Доступность</span><select id="catalog-status">${option('all','Все отчеты',status)}${Object.entries(catalogStatusLabels).map(([id,label])=>option(id,label,status)).join('')}</select></label></div>`;
}
export function renderCatalogResults(filters){
 const list=filterCatalog(filters);
 const summary=`<div class="catalog-count" role="status">Найдено: <strong>${list.length}</strong><span>${archiveForms.length} Excel-формы · ${departments.length} управлений</span><button type="button" class="button small ghost" data-action="catalog-reset">Показать все</button></div>`;
 if(!list.length)return summary+`<div class="empty"><h3>Отчеты не найдены</h3><p>Измените название, управление или доступность.</p></div>`;
 return summary+catalogGroups.map(d=>{
  const rows=list.filter(r=>r.departmentId===d.id);if(!rows.length)return '';
  return `<section class="department-section" aria-labelledby="department-${d.id}"><div class="department-heading"><h3 id="department-${d.id}">${d.number?`<span>${d.number}.</span> `:''}${esc(d.name)}</h3><span class="counter">${rows.length}</span></div><table class="catalog-table"><thead><tr><th scope="col" class="catalog-number">№</th><th scope="col">Наименование отчета</th><th scope="col" class="catalog-state">Формат</th><th scope="col" class="catalog-action"><span class="visually-hidden">Действие</span></th></tr></thead><tbody>${rows.map(r=>{
   const ready=r.archiveFormId||r.reportId;
   return `<tr data-catalog-id="${r.id}"><td class="catalog-number">${r.number}</td><th scope="row">${ready?`<button type="button" class="catalog-name" data-action="${r.archiveFormId?'open-archive':'open-report'}" data-id="${esc(ready)}">${esc(r.name)}</button>`:`<span class="catalog-name">${esc(r.name)}</span>`}${r.sourceFile?`<small class="catalog-filename">${esc(r.sourceFile.split('/').at(-1))}</small>`:''}</th><td class="catalog-state">${ready?'<span class="catalog-format">Excel</span>':'—'}</td><td class="catalog-action">${ready?`<button type="button" class="button small" data-action="${r.archiveFormId?'open-archive':'open-report'}" data-id="${esc(ready)}" aria-label="Сформировать: ${esc(r.name)}">Сформировать</button>`:'<span class="muted small-text">В перечне</span>'}</td></tr>`;
  }).join('')}</tbody></table></section>`;
 }).join('');
}
export function catalogDetail(id){
 const r=catalogReports.find(item=>item.id===id);if(!r)return null;
 return {title:r.name,reportId:r.reportId,body:`<p>${esc(catalogGroups.find(d=>d.id===r.departmentId)?.name)}</p><p>${r.archiveFormId||r.reportId?'Форма доступна для формирования.':'Форма включена в перечень отчетности.'}</p>`};
}
