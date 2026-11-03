import {records, defaultFilters} from './data.js';
import {filterRecords} from './engine.js';
import {expandPlanLayout} from './received-engine.js';

const missing = 'Нет данных';
const numeric = value => typeof value === 'number' && Number.isFinite(value);
const display = value => value == null || value === '' ? missing : value;
const sum = values => values.every(numeric) ? values.reduce((a,b) => a+b, 0) : null;
const normal = value => String(value ?? '').toLocaleLowerCase('ru').replaceAll('ё','е').replace(/[^а-яа-ұa-z0-9]/g,'');
const dateText = value => value ? value.split('-').reverse().join('.') : value;
const fields = {'financial-audit-approvals':'approvals','financial-audit-results':'results','financial-audit-transfers':'transfers','financial-audit-administrative':'administrative'};
const dates = {approvals:'sentAt',results:'date',transfers:'transferredAt',administrative:'decisionAt'};
const statusColumns = {'возбуждено':'D','приобщено к ердр':'E','отказано в возбуждении':'F','направлено в другие органы':'G','списано в спецнаряд':'H','на рассмотрении':'I','прекращено':'J','направлено в суд':'K','в производстве':'L'};
const statusByKey = new Map(Object.entries(statusColumns).map(([label,column]) => [normal(label),column]));

export const financialAuditReportDescriptions = {
 'financial-audit-approvals': {amountUnit:'не применяется',reportingRule:'Отбираются отправки на согласование за выбранный период. Повторные отправки представлены отдельными событиями.',description:'Объекты аудита, отправители и подтверждающие документы по направлению дел на согласование.'},
 'financial-audit-results': {amountUnit:'тыс. тенге; количество',reportingRule:'Результаты отбираются по дате сведений об аудите финансовой отчетности. Балансы и искажения берутся из отдельных показателей этой формы.',description:'Валюта баланса и нарушения, повлекшие и не повлекшие искажения финансовой отчетности.'},
 'financial-audit-transfers': {amountUnit:'количество; суммы в единице источника',reportingRule:'Передачи за выбранный период. Последнее состояние рассмотрения и производства — на дату «по». Сумма одного факта нарушения учитывается один раз.',description:'Переданные материалы и результаты их рассмотрения по ДВГА и КВГА.'},
 'financial-audit-administrative': {amountUnit:'тенге',reportingRule:'Административные дела отбираются по дате решения. Взыскания и обжалования учитываются на дату «по». Принудительное взыскание входит в общую взысканную сумму.',description:'Решения по административным делам, штрафы, взыскания и обжалования.'}
};

function checkDate(value, label) {
 const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : null;
 if (!date || !Number.isFinite(+date) || date.toISOString().slice(0,10) !== value)
  throw new Error(`Некорректная или отсутствующая дата: ${label}.`);
 return value;
}
function unique(items, label) {
 if (!Array.isArray(items)) throw new Error(`Ожидается список: ${label}.`);
 const seen = new Map();
 for (const item of items) {
  if (!item?.id) throw new Error(`Отсутствует идентификатор: ${label}.`);
  if (seen.has(item.id) && JSON.stringify(seen.get(item.id)) !== JSON.stringify(item))
   throw new Error(`Противоречивые данные ${label}: ${item.id}.`);
  seen.set(item.id,item);
 }
 return [...seen.values()];
}
function demo() {
 // Every fact here is synthetic. None is copied from the supplied examples.
 return records.filter(row => row.module === 'ВГА').map((row,index) => {
  const day = `${row.date.slice(0,7)}-24`, id = row.id;
  const distorting = (index + 1) * 120, other = (index % 4) * 60, fine = (index + 1) * 10000;
  return {...row,financialAudit:{
   approvals:[{id:`DEMO-SENT-${id}`,sentAt:day,sender:`Учебный отправитель ${index+1}`,documentLinks:[`Документ учебного дела ${id}`]}],
   results:[{id:`DEMO-RESULT-${id}`,date:day,balanceStart:(index+10)*10000,balanceEnd:(index+11)*10000,totalViolations:distorting+other,distortingAmount:distorting,distortingCount:1,nonDistortingAmount:other,nonDistortingCount:index%4,reviewer:`Учебный проверяющий ${index+1}`}],
   transfers:index%3===0?[{id:`DEMO-TRANSFER-${id}`,transferredAt:day,factId:`DEMO-FACT-${id}`,amount:(index+1)*25000,statusEvents:[{id:`DEMO-STATUS-${id}`,date:day,status:index%2?'возбуждено':'на рассмотрении'}]}]:[],
   administrative:index%2===0?[{id:`DEMO-ADMIN-${id}`,person:`Учебное лицо ${index+1}`,basis:'ДВГА',article:'Учебная статья',reviewingBody:'ДВГА',decision:'наложено',decisionAt:day,fine,
    collections:[{id:`DEMO-PAYMENT-${id}`,date:day,amount:fine/2,kind:index%4?'enforced':'voluntary'}],enforcementSentAt:index%4?day:null,appeals:[]}]:[]
  }};
 });
}
function selected(form, config, source) {
 const filters = config.filters, key = fields[form.id], dateKey = dates[key];
 const parents = unique((source===records?demo():source).filter(row=>row.module==='ВГА'),'дела');
 const ids = new Set(filterRecords(parents.map(row=>({...row,date:filters.to})),{sources:['ВГА'],filters}).map(row=>row.id));
 const selectedParents = parents.filter(row=>ids.has(row.id));
 const events = [], seen = new Map();
 for (const parent of selectedParents) {
  const supplied = parent.financialAudit?.[key];
  if (supplied == null) continue;
  for (const event of unique(supplied,key)) {
   const date = checkDate(event[dateKey],`${key}/${event.id}`);
   if (date < filters.from || date > filters.to) continue;
   if (seen.has(event.id)) throw new Error(`Событие ${event.id} связано с несколькими делами.`);
   seen.set(event.id,parent.id);events.push({parent,event});
  }
 }
 const childOwners = new Map();
 for (const {event} of events) for (const childKey of ['collections','statusEvents','appeals']) {
  if (event[childKey] == null) continue;
  for (const child of unique(event[childKey], childKey)) {
   const identity = `${childKey}:${child.id}`;
   if (childOwners.has(identity) && childOwners.get(identity) !== event.id)
    throw new Error(`Событие ${child.id} связано с несколькими родительскими записями.`);
   childOwners.set(identity,event.id);
  }
 }
 return events;
}
function year(event, date) {return Number.isInteger(event.year)?event.year:Number(date.slice(0,4));}
function approvals({parent,event}, index) {
 const links = Array.isArray(event.documentLinks)?event.documentLinks.filter(value=>typeof value==='string'&&value.trim()).join('\n'):null;
 return {B:index+1,C:year(event,event.sentAt),D:parent.object,E:parent.bin,F:parent.kind,G:event.sender,H:dateText(event.sentAt),I:links};
}
function results({parent,event}, index) {
 return {B:index+1,C:year(event,event.date),D:parent.object,E:parent.bin,F:numeric(event.balanceStart)?event.balanceStart:null,G:numeric(event.balanceEnd)?event.balanceEnd:null,
  H:numeric(event.totalViolations)?event.totalViolations:null,I:numeric(event.distortingAmount)?event.distortingAmount:null,J:numeric(event.distortingCount)?event.distortingCount:null,
  K:numeric(event.nonDistortingAmount)?event.nonDistortingAmount:null,L:numeric(event.nonDistortingCount)?event.nonDistortingCount:null,M:event.reviewer};
}
function administrative({event}, index, filters) {
 let payments = null;
 if (event.collections != null) payments = unique(event.collections,'взыскания').filter(payment=> {
  checkDate(payment.date,`взыскание ${payment.id}`);
  if (payment.date < event.decisionAt) throw new Error('Взыскание предшествует решению по административному делу.');
  if (!['voluntary','enforced'].includes(payment.kind)) throw new Error('Неизвестный вид взыскания.');
  return payment.date <= filters.to;
 });
 const total = payments ? sum(payments.map(payment=>payment.amount)) : null;
 const enforced = payments ? sum(payments.filter(payment=>payment.kind==='enforced').map(payment=>payment.amount)) : null;
 if (payments?.some(payment=>numeric(payment.amount)&&payment.amount<0)) throw new Error('Сумма взыскания не может быть отрицательной.');
 if (numeric(event.fine)&&event.fine<0) throw new Error('Сумма штрафа не может быть отрицательной.');
 if (numeric(event.fine)&&numeric(total)&&total>event.fine) throw new Error('Взысканная сумма превышает сумму штрафа.');
 let enforcement;
 if (event.enforcementSentAt===null) enforcement='—';
 else if (event.enforcementSentAt!==undefined) {
  checkDate(event.enforcementSentAt,'направление на принудительное взыскание');
  enforcement=event.enforcementSentAt<=filters.to?dateText(event.enforcementSentAt):'—';
 }
 let bodies=null,outcomes=null;
 if (event.appeals!=null) {
  const appeals=unique(event.appeals,'обжалования').filter(appeal=> {
   checkDate(appeal.date,`обжалование ${appeal.id}`);
   if (appeal.resultAt!=null) {
    checkDate(appeal.resultAt,`результат обжалования ${appeal.id}`);
    if (appeal.resultAt<appeal.date) throw new Error('Результат обжалования предшествует обращению.');
   }
   return appeal.date<=filters.to;
  });
  bodies=appeals.length?appeals.map(appeal=>display(appeal.body)).join('; '):'—';
  outcomes=appeals.length?appeals.map(appeal=>appeal.resultAt&&appeal.resultAt<=filters.to?display(appeal.result):missing).join('; '):'—';
 }
 return {A:index+1,B:event.person,C:event.basis,D:event.article,E:event.reviewingBody,F:event.decision,G:dateText(event.decisionAt),H:numeric(event.fine)?event.fine:null,I:total,J:enforcement,K:enforced,L:bodies,M:outcomes};
}
function transferRegion(schema,parent) {
 const central=schema.dataRows.find(row=>row.central);
 if ([parent.centralUnit,parent.organ].some(value=>central.regionAliases.some(alias=>normal(alias)===normal(value)))) return central.id;
 const region=schema.dataRows.find(row=>!row.central&&[row.region,...row.regionAliases].some(alias=>normal(alias)===normal(parent.region)));
 if (!region) throw new Error(`ДВГА дела «${parent.id}» отсутствует среди строк исходной формы.`);
 return region.id;
}
function transferValues(items,to) {
 const result={C:items.length},known=items.every(item=>Array.isArray(item.event.statusEvents));
 const reached=items.map(({event})=> {
  if (!event.statusEvents) return null;
  const latest=new Map(),datesByGroup=new Map();
  for (const status of unique(event.statusEvents,'стадии рассмотрения')) {
   checkDate(status.date,`стадия ${status.id}`);
   if (status.date<event.transferredAt) throw new Error('Стадия рассмотрения предшествует передаче материала.');
   const column=statusByKey.get(normal(status.status));
   if (!column) throw new Error(`Неизвестная стадия рассмотрения: ${status.status}.`);
   if (status.date>to) continue;
   const group=['J','K','L'].includes(column)?'proceedings':'review';
   const dateKey=`${group}:${status.date}`;
   if (datesByGroup.has(dateKey)&&datesByGroup.get(dateKey)!==column)
    throw new Error(`Неоднозначный порядок стадий материала ${event.id} на ${status.date}.`);
   datesByGroup.set(dateKey,column);
   if (!latest.has(group)||latest.get(group).date<status.date) latest.set(group,{date:status.date,column});
  }
  return new Set([...latest.values()].map(state=>state.column));
 });
 for (const column of Object.values(statusColumns)) result[column]=known?reached.filter(set=>set.has(column)).length:null;
 const facts=new Map();let complete=true;
 for (const {event} of items) {
  if (!event.factId||!numeric(event.amount)) {complete=false;continue;}
  facts.set(event.factId,event.amount);
 }
 result.M=complete?sum([...facts.values()]):null;
 return result;
}
function transferSheet(schema,items,filters) {
 const layout=structuredClone(schema.templateLayout),facts=new Map();
 const classified=items.map(item=>({...item,regionId:transferRegion(schema,item.parent)}));
 for (const item of classified) {
  const {event,regionId}=item;
  if (!event.factId) continue;
  if (facts.has(event.factId)) {
   const previous=facts.get(event.factId);
   if (previous.regionId!==regionId||previous.amount!==event.amount) throw new Error(`Противоречивые данные факта нарушения ${event.factId}.`);
  }
  facts.set(event.factId,{regionId,amount:event.amount});
 }
 const entries=schema.dataRows.map(row=> {
  const members=classified.filter(item=>item.regionId===row.id);
  return {_sourceRow:row.sourceRow,...(members.length?transferValues(members,filters.to):{})};
 });
 for (const total of schema.totalRows) entries.push({_sourceRow:total.sourceRow,...(items.length?transferValues(classified,filters.to):{})});
 return finish(schema,layout,entries);
}
function finish(schema,layout,entries) {
 for (const entry of entries) for (const column of schema.columns)
  if (column.labels.length&&Object.hasOwn(entry,column.letter)) layout.cells[`${column.letter}${entry._sourceRow}`]=display(entry[column.letter]);
 const columns=schema.columns.map(column=>({id:column.letter,label:column.labels.join(' · ')||`Позиция ${column.letter}`,labels:column.labels,group:column.labels[0]||'',available:column.labels.length>0}));
 return {id:schema.id,name:schema.name,sourceSheetName:schema.sourceSheetName,columns,headerCells:schema.headerCells,headerDepth:schema.headerDepth,merges:schema.merges,
  templateLayout:layout,sourceRowNumbers:entries.map(entry=>entry._sourceRow),rows:entries.map(entry=>schema.columns.map(column=>layout.cells[`${column.letter}${entry._sourceRow}`]??null))};
}
function variableSheet(form,schema,items,filters) {
 const layout=structuredClone(schema.templateLayout),placement=schema.sourcePlacement;
 const values=items.map((item,index)=>form.id==='financial-audit-approvals'?approvals(item,index):form.id==='financial-audit-results'?results(item,index):administrative(item,index,filters));
 const slots=placement.dataEnd-placement.dataStart+1;
 expandPlanLayout(layout,placement,values.length);
 const entries=Array.from({length:Math.max(slots,values.length)},(_,index)=>({_sourceRow:placement.dataStart+index,...values[index]}));
 if (placement.totalRow) {
  const total={_sourceRow:placement.totalRow+Math.max(0,values.length-slots)};
  if (values.length) for (const key of ['H','I','K']) total[key]=sum(values.map(row=>row[key]));
  entries.push(total);
 }
 if (form.id==='financial-audit-administrative') {
  const organs=[...new Set(items.map(item=>item.parent.organ).filter(Boolean))];
  layout.cells.A2=filters.organ||(filters.region?`ДВГА по ${filters.region}`:organs.length===1?organs[0]:'ДВГА');
 }
 return finish(schema,layout,entries);
}
export function generateFinancialAuditReport(form,config,sourceRecords=records) {
 const filters={...defaultFilters(),...config.filters},items=selected(form,{...config,filters},sourceRecords);
 const sheets=form.sheets.map(schema=>form.id==='financial-audit-transfers'?transferSheet(schema,items,filters):variableSheet(form,schema,items,filters));
 return {config:{...config,...financialAuditReportDescriptions[form.id],filters},createdAt:new Date().toISOString(),recordCount:items.length,
  objectCount:new Set(items.map(item=>item.parent.bin).filter(Boolean)).size,sheets};
}
