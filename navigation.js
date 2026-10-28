import {catalogGroups} from './catalog.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=path=>`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
const allIcon=icon('M6 3h8l4 4v14H6z M14 3v5h5 M9 12h6 M9 16h6');
const extraIcon=icon('M3 7h6l2 3h10v10H3z');

export function departmentTitle(id){
 return catalogGroups.find(department=>department.id===id)?.name||'Все отчеты';
}

/** Render inside .saq-module-menu; the app handles data-action="department". */
export function renderDepartmentNavigation({department='all',view='catalog'}={}){
 const inCatalog=['catalog','report'].includes(view);
 const button=(id,label,mark,extra='')=>{
  const active=inCatalog&&department===id;
  return `<button type="button" class="department-nav-button ${extra}${active?' active':''}" data-action="department" data-id="${esc(id)}" title="${esc(label)}" aria-label="${esc(label)}"${active?' aria-current="page"':''}>${mark}<span class="department-nav-label">${esc(label)}</span></button>`;
 };
 return `<div class="department-navigation"><p class="department-nav-caption">Управления</p>${catalogGroups.map(d=>button(d.id,d.name,d.number?`<b class="department-nav-number" aria-hidden="true">${d.number}</b>`:extraIcon,d.number?'':'department-nav-additional')).join('')}${button('all','Все отчеты',allIcon,'department-nav-all')}</div>`;
}
