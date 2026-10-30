import {records,defaultFilters} from './data.js';
import {filterRecords} from './engine.js';
import {receivedDemoFacts} from './received-demo-data.js';

const missing='Нет данных';
const isNumber=value=>typeof value==='number'&&Number.isFinite(value);
const number=value=>isNumber(value)?value:null;
const printable=value=>value==null||value===''?missing:value;
const sum=(rows,get)=>rows.every(row=>isNumber(get(row)))?rows.reduce((total,row)=>total+get(row),0):null;
const percent=(part,total)=>isNumber(part)&&isNumber(total)&&total>0?Math.round(part/total*10000)/100:null;
const millions=value=>isNumber(value)?value/1000:null;
const quarter=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?Math.ceil(Number(value.slice(5,7))/3):null;
const knownDate=value=>value===null||typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value);
const happened=(value,to)=>typeof value==='string'&&value<=to;
const within=(date,filters)=>typeof date==='string'&&date>=filters.from&&date<=filters.to;
const planIds=new Set(['received-plan-detail','received-plan-monitoring','received-plan-summary']);

export const receivedReportDescriptions={
 'received-plan-detail':{amountUnit:'млн тенге',reportingRule:'Перечень за год даты «по». Назначения, завершения и исключения учитываются на дату «по». Планируемый охват берется из Перечня, суммы нарушений — из завершенного аудита.',description:'Исполнение Перечня по каждому объекту, сроки, поручения и результаты аудита.'},
 'received-plan-monitoring':{amountUnit:'количество; проценты',reportingRule:'План за год даты «по», события накопительно на дату «по». Квартал определяется плановым сроком. Остаток = план − завершено. Исключенные к этой дате позиции не входят в действующий план. Проценты — от годового плана.',description:'Годовой план и исполнение по кварталам. Состояние определяется на конец выбранного периода.'},
 'received-plan-summary':{amountUnit:'млн тенге',reportingRule:'Действующий Перечень за год даты «по». Всего = аудит соответствия (АС) + аудит финансовой отчетности (АФО). Квартальная разбивка и плановый охват относятся ко всем аудитам (АС + АФО).',description:'Количество плановых аудитов АС и АФО. Плановый охват и квартальная разбивка — по всем аудитам.'},
 'received-assignment-decisions':{amountUnit:'количество',reportingRule:'Решения по поручениям, принятые в выбранном периоде. Всего = подтверждено + отклонено. Предписания и их исполнение в этот отчет не включаются.',description:'Подтвержденные и отклоненные поручения с причинами отклонения.'},
 'received-electronic-rating':{amountUnit:'млн тенге; проценты; процентные пункты',reportingRule:'Аудиты по отчетной дате в выбранном периоде. Доля = электронные / все аудиты × 100. Отклонение = доля − целевой показатель 29%, в процентных пунктах. Нарушения учитываются по электронным аудитам.',description:'Доля электронных аудитов, отклонение от целевого показателя 29% и суммы выявленных ими нарушений.'},
 'received-quality-journal':{amountUnit:'не применяется',reportingRule:'Заключения контроля качества с результатом «Не соответствуют Стандартам ГАФК», утвержденные в выбранном периоде. Дата отбора — дата заключения КК.',description:'Материалы с установленным несоответствием Стандартам ГАФК по дате заключения контроля качества.'}
};

function distinct(source){
 const map=new Map();
 for(const row of source){
  if(row.module!=='ВГА')continue;
  if(!row.id)throw new Error('У дела отсутствует идентификатор.');
  if(map.has(row.id)&&JSON.stringify(map.get(row.id))!==JSON.stringify(row))throw new Error(`Противоречивые данные дела ${row.id}.`);
  map.set(row.id,row);
 }
 return [...map.values()];
}
function grouped(rows){
 const groups=new Map();
 for(const row of rows){const id=row.organ||missing;if(!groups.has(id))groups.set(id,[]);groups.get(id).push(row);}
 return [...groups.entries()].map(([organ,items])=>({organ,region:items[0].region,items}));
}
function selected(form,config,source){
 const filters={...defaultFilters(),...config.filters};
 const sourceRows=distinct(source).map(row=>source===records?{...row,...receivedDemoFacts[row.id]}:row);
 // Registry and event reports use their own plan/event date. The common filters
 // still apply to the parent audit; its report date must not suppress an event.
 const ownDate=form.id!=='received-electronic-rating';
 const lookup=sourceRows.map(row=>ownDate?{...row,date:filters.to}:row);
 const keys=new Set(filterRecords(lookup,{sources:['ВГА'],filters}).map(row=>row.id));
 let rows=sourceRows.filter(row=>keys.has(row.id));
 if(planIds.has(form.id)){
  const year=Number(filters.to.slice(0,4));
  // Missing membership is retained as unknown, never invented as an actual plan.
  rows=rows.filter(row=>row.plan?.year==null||row.plan.year===year);
  if(form.id!=='received-plan-detail')rows=rows.filter(row=>!happened(row.plan?.excludedAt,filters.to));
 }
 if(form.id==='received-assignment-decisions')rows=rows.filter(row=>!Array.isArray(row.assignmentDecisions)||row.assignmentDecisions.some(event=>within(event.date,filters)));
 return rows;
}
function planKnown(row){return row.plan&&Number.isInteger(row.plan.year)&&[1,2,3,4].includes(row.plan.quarter)&&knownDate(row.plan.excludedAt);}
function monitoring(items,to){
 const result={};
 const known=items.every(planKnown);
 const counts=[];
 for(let q=1;q<=4;q++){
  const rows=items.filter(row=>row.plan?.quarter===q);
  const plan=known?rows.length:null;
  const assigned=known&&rows.every(row=>knownDate(row.plan.assignedAt))?rows.filter(row=>happened(row.plan.assignedAt,to)).length:null;
  const completed=known&&rows.every(row=>knownDate(row.plan.completedAt))?rows.filter(row=>happened(row.plan.completedAt,to)).length:null;
  counts.push({plan,assigned,completed,notAssigned:isNumber(plan)&&isNumber(assigned)?plan-assigned:null,remaining:isNumber(plan)&&isNumber(completed)?plan-completed:null});
 }
 for(const [q,columns] of [[0,['E','F','G','H']],[1,['I','J','K','L']],[2,['M','N','P','Q']],[3,['R','S','T','U']]]){
  [result[columns[0]],result[columns[1]],result[columns[2]],result[columns[3]]]=[counts[q].plan,counts[q].assigned,counts[q].completed,counts[q].remaining];
 }
 result.O=counts[2].notAssigned;
 result.D=result.V=sum(counts,row=>row.plan);
 result.W=sum(counts,row=>row.assigned);result.X=percent(result.W,result.V);
 result.Y=sum(counts,row=>row.completed);result.Z=percent(result.Y,result.V);
 result.AA=sum(counts,row=>row.remaining);result.AB=percent(result.AA,result.V);
 return result;
}
function summary(items){
 const known=items.every(row=>planKnown(row)&&['Соответствие','Финансовая отчетность'].includes(row.plan.kind));
 const compliance=items.filter(row=>row.plan?.kind==='Соответствие');
 const result={D:known?items.length:null,E:known?compliance.length:null,F:known?millions(sum(items,row=>row.plan.coverage)):null,O:known?items.filter(row=>row.plan.kind==='Финансовая отчетность').length:null};
 for(const [q,countCol,amountCol]of [[1,'G','H'],[2,'I','J'],[3,'K','L'],[4,'M','N']]){
  const rows=items.filter(row=>row.plan?.quarter===q);
  result[countCol]=known?rows.length:null;result[amountCol]=known?millions(sum(rows,row=>row.plan.coverage)):null;
 }
 return result;
}
function detail(row,to,index){
 const plan=row.plan,completed=happened(plan?.completedAt,to),assigned=happened(plan?.assignedAt,to),excluded=happened(plan?.excludedAt,to);
 const execution=excluded?`Исключен ${plan.excludedAt}: ${plan.exclusionReason||missing}`:assigned?`${plan.orderNumber||missing} от ${plan.assignedAt}${completed?`; завершен ${plan.completedAt}`:''}`:plan?.assignedAt===null||knownDate(plan?.assignedAt)?'Не назначен':null;
 return {A:index+1,B:row.object,C:plan?.kind||row.kind,D:row.auditType,E:plan?.event,F:plan?.quarter,G:completed?quarter(plan.completedAt):null,H:row.id,I:execution,J:millions(plan?.coverage),K:completed&&isNumber(row.financial)&&isNumber(row.procedural)?millions(row.financial+row.procedural):null,L:completed?millions(row.financial):null,M:completed?millions(row.procedural):null,N:row.auditor};
}
function decisions(items,filters){
 const known=items.every(row=>Array.isArray(row.assignmentDecisions));
 const events=items.flatMap(row=>row.assignmentDecisions||[]).filter(event=>within(event.date,filters));
 const confirmed=events.filter(event=>event.result==='Подтверждено'),rejected=events.filter(event=>event.result==='Отклонено');
 const valid=known&&events.every(event=>['Подтверждено','Отклонено'].includes(event.result));
 return {C:valid?events.length:null,D:valid?confirmed.length:null,E:valid?rejected.length:null,F:valid?[...new Set(rejected.map(event=>event.reason||missing))].join('; ')||'—':null};
}
function electronic(items){
 const formatsKnown=items.every(row=>['Электронный','Бумажный'].includes(row.format));
 const electronic=items.filter(row=>row.format==='Электронный');
 const rate=formatsKnown?percent(electronic.length,items.length):null;
 return {D:items.length,E:formatsKnown?electronic.length:null,F:rate,G:rate==null?null:Math.round((rate-29)*100)/100,H:formatsKnown?millions(sum(electronic,row=>row.financial)):null,I:formatsKnown?millions(sum(electronic,row=>row.procedural)):null};
}
function journal(items,filters){
 const rows=[];
 for(const row of items)for(const event of row.qualityChecks||[]){
  if(event.result!=='Не соответствуют Стандартам ГАФК'||!within(event.date,filters))continue;
  rows.push({A:rows.length+1,B:event.date,C:event.caseCreatedAt?`${row.id} от ${event.caseCreatedAt}`:row.id,D:row.organ,E:row.object,F:row.kind,G:event.reportNumber&&event.reportDate?`${event.reportNumber} от ${event.reportDate}`:null,H:row.auditor,I:event.responsible,J:event.reviewer,K:event.result,L:event.basis,_caseId:row.id});
 }
 return rows;
}
function outputRows(form,items,filters){
 if(form.id==='received-plan-detail'){
  const rows=items.map((row,index)=>detail(row,filters.to,index));
  if(rows.length)rows.push({B:'Итого',J:sum(rows,row=>row.J),K:sum(rows,row=>row.K),L:sum(rows,row=>row.L),M:sum(rows,row=>row.M),_total:true});
  return rows;
 }
 if(form.id==='received-quality-journal')return journal(items,filters);
 const rows=grouped(items).map(({organ,region,items},index)=>{
  if(form.id==='received-plan-monitoring')return {B:index+1,C:organ,...monitoring(items,filters.to)};
  if(form.id==='received-plan-summary')return {B:index+1,C:organ,...summary(items)};
  if(form.id==='received-assignment-decisions')return {A:index+1,B:region||organ,...decisions(items,filters)};
  if(form.id==='received-electronic-rating')return {B:index+1,C:organ,...electronic(items)};
  throw new Error('Неизвестная полученная форма.');
 });
 if(rows.length){
  // Recalculate each total from its full population. Percentages, in particular,
  // must never be summed or averaged across departments of different sizes.
  if(form.id==='received-plan-monitoring')rows.push({B:'Итого',...monitoring(items,filters.to),_total:true});
  if(form.id==='received-plan-summary')rows.push({B:'Итого',...summary(items),_total:true});
  if(form.id==='received-assignment-decisions')rows.push({A:'Итого',...decisions(items,filters),_total:true});
  if(form.id==='received-electronic-rating')rows.push({B:'Итого',...electronic(items),_total:true});
 }
 return rows;
}

export function generateReceivedReport(form,config,sourceRecords=records){
 const filters={...defaultFilters(),...config.filters},items=selected(form,{...config,filters},sourceRecords);
 const values=outputRows(form,items,filters),year=Number(filters.to.slice(0,4));
 const sheets=form.sheets.map(sheet=>{
  const headerCells={...sheet.headerCells};
  if(form.id==='received-plan-summary')headerCells.D1=year;
  if(form.id==='received-plan-monitoring')headerCells.D1=`Плановые аудиты на ${year} год`;
  const columns=sheet.columns.map(column=>{
   const labels=column.labels.map(label=>form.id==='received-plan-summary'&&/^20\d\d$/.test(label)?String(year):form.id==='received-plan-monitoring'?label.replace(/на 20\d\d год/,`на ${year} год`):label);
   return {id:column.letter,label:labels.join(' · ')||`Позиция ${column.letter}`,labels,group:labels[0]||'',available:labels.length>0};
  });
  return {id:sheet.id,name:sheet.name,columns,headerCells,headerDepth:sheet.headerDepth,merges:sheet.merges,rows:values.map(row=>sheet.columns.map(column=>!column.labels.length||row._total&&!Object.hasOwn(row,column.letter)?null:printable(row[column.letter])))};
 });
 const resultItems=form.id==='received-quality-journal'?items.filter(item=>values.some(row=>row._caseId===item.id)):items;
 return {config:{...config,...receivedReportDescriptions[form.id],filters},createdAt:new Date().toISOString(),recordCount:resultItems.length,objectCount:new Set(resultItems.map(row=>row.bin).filter(Boolean)).size,sheets};
}
