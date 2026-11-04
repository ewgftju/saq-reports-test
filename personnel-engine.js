import {records} from './data.js';
import {expandPlanLayout} from './received-engine.js';

export const personnelReportDescriptions = {
 'personnel-kvga-staff': {
  reportingRule:'Список сотрудников КВГА по подразделениям на выбранную дату. На демонстрационном стенде используются вымышленные сотрудники.',
  description:'Должности, ФИО и примечания по подразделениям КВГА.',
  personnel:true
 }
};
const normal = value => String(value ?? '').toLocaleLowerCase('ru').replaceAll('ё','е').replace(/\s+/g,' ').trim();
const text = value => value == null || typeof value === 'string' && !value.trim() ? 'Нет данных' : value;
function date(value,label) {
 const parsed = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : null;
 if (!parsed || !Number.isFinite(+parsed) || parsed.toISOString().slice(0,10)!==value) throw new Error(`Проверьте дату: ${label}.`);
 return value;
}
function demo(sections) {
 return sections.flatMap((section,index)=>[0,1].map(i=>({
  id:`DEMO-STAFF-${section.id}-${i+1}`,sectionId:section.id,
  position:i?'Главный эксперт':'Руководитель',fullName:`Учебный сотрудник ${index*2+i+1}`,
  note:'',startDate:'2026-01-01',endDate:null
 })));
}
function selected(source,sections,filters) {
 const groups=new Map(sections.map(section=>[section.id,section])),seen=new Map();
 if(!Array.isArray(source))throw new Error('Ожидается список кадровых записей.');
 for(const row of source){
  if(!row || typeof row.id!=='string' || !row.id.trim())throw new Error('У кадровой записи отсутствует идентификатор.');
  if(!groups.has(row.sectionId))throw new Error('Подразделение кадровой записи отсутствует в образце КВГА.');
  date(row.startDate,'начало работы');
  if(row.endDate!=null){date(row.endDate,'последний рабочий день');if(row.endDate<row.startDate)throw new Error('Последний рабочий день предшествует началу работы.');}
  for(const key of ['position','fullName','note'])if(row[key]!=null&&typeof row[key]!=='string')throw new Error('Проверьте текстовые поля кадровой записи.');
  const item={id:row.id,sectionId:row.sectionId,position:row.position??null,fullName:row.fullName??null,note:row.note??'',startDate:row.startDate,endDate:row.endDate??null};
  if(seen.has(item.id)&&JSON.stringify(seen.get(item.id))!==JSON.stringify(item))throw new Error(`Противоречивые данные кадровой записи ${item.id}.`);
  seen.set(item.id,item);
 }
 const query=normal(filters.query);
 return [...seen.values()].filter(item=>item.startDate<=filters.to&&(!item.endDate||item.endDate>=filters.to))
  .filter(item=>!query||normal([item.fullName,item.position,item.note,groups.get(item.sectionId).label].join(' ')).includes(query));
}
export function generatePersonnelReport(form,config,sourceRecords=records) {
 for(const [key,value] of Object.entries(config.filters))if(!['from','to','query'].includes(key)&&value!==''&&value!=null&&value!==false)throw new Error('В кадровом отчёте доступны дата состояния и поиск.');
 const schema=form.sheets[0],sections=schema.sections;
 const items=selected(sourceRecords===records?demo(sections):sourceRecords,sections,config.filters);
 const layout=structuredClone(schema.templateLayout);
 const groups=sections.map(section=>({...section,items:items.filter(item=>item.sectionId===section.id)}));
 for(const group of groups)group.extra=Math.max(0,group.items.length-group.dataRows.length);
 for(const group of [...groups].reverse())expandPlanLayout(layout,{dataStart:group.dataRows[0],dataEnd:group.dataRows.at(-1)},group.items.length);
 const entries=[],sectionHeaderRows=[];let offset=0,ordinal=0;
 for(const group of groups){
  const header=group.headerRow+offset;
  sectionHeaderRows.push(header);entries.push(header);
  const slots=Math.max(group.dataRows.length,group.items.length);
  for(let index=0;index<slots;index++){
   const row=group.dataRows[0]+offset+index,item=group.items[index];ordinal++;
   // Numbers are generated data. An empty export retains the original template,
   // including its numbering; a populated list has consecutive position numbers.
   if(items.length)layout.cells[`B${row}`]=ordinal;
   if(item){layout.cells[`C${row}`]=text(item.position);layout.cells[`D${row}`]=text(item.fullName);layout.cells[`E${row}`]=item.note;}
   if(item||!items.length)entries.push(row);
  }
  offset+=group.extra;
 }
 const columns=schema.columns.map(column=>({id:column.letter,label:column.labels.join(' · ')||`Позиция ${column.letter}`,labels:column.labels,group:'',available:column.labels.length>0,structural:column.labels.length===0}));
 const sheet={id:schema.id,name:schema.name,sourceSheetName:schema.sourceSheetName,columns,headerCells:schema.headerCells,
  headerDepth:schema.headerDepth,merges:layout.merges,templateLayout:layout,sourceRowNumbers:entries,sectionHeaderRows,
  rows:entries.map(row=>schema.columns.map(column=>layout.cells[`${column.letter}${row}`]??null))};
 return {config,createdAt:new Date().toISOString(),recordCount:items.length,objectCount:0,sheets:[sheet]};
}
