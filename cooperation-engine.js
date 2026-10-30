import {records,defaultFilters} from './data.js';
import {filterRecords} from './engine.js';

export const cooperationReportDescriptions={
 'cooperation-sva-summary':{
  amountUnit:'тыс. тенге',
  reportingRule:'Завершенные дела СВА, включенные в отчетность, по отчетной дате за выбранный период. Неизвестные показатели обозначены «Нет данных».',
  description:'Итоги деятельности СВА: ЦГО, МИО, ДП и общий итог.'
 }
};
const missing='Нет данных';
const numeric=value=>typeof value==='number'&&Number.isFinite(value);
const sum=values=>values.length&&values.every(numeric)?values.reduce((a,b)=>a+b,0):null;
const add=(a,b)=>numeric(a)&&numeric(b)?a+b:null;
const ratio=(a,b)=>numeric(a)&&numeric(b)&&b>0?a/b:null;
const col=n=>{let s='';for(;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
const display=value=>value==null?missing:value;

// Only the existing synthetic SVA population gets this explicit demonstration
// mapping. Uploaded observations and custom records are never enriched with it.
const demoInstitutions={'г. Астана':'mio-15','г. Алматы':'mio-16','Акмолинская область':'mio-01','Атырауская область':'mio-04','Карагандинская область':'mio-08','Туркестанская область':'mio-14'};
const maps={
 cgo:{C:'annualPlan',D:'amendedPlan',E:'planCovered',F:'unplanned',G:'auditCount',H:'asCount',I:'aeCount',J:'additionalAuditCount',K:'additionalAsCount',L:'additionalAeCount',M:'coverage',N:'violations',O:'financial',P:'procedural',Q:'procurementCoverage',R:'procurementFinancialAffected',S:'procurementProceduralAffected',T:'procurementFinancialUnaffected',U:'procurementProceduralUnaffected',V:'due',W:'dueRestore',X:'dueReimburse',Y:'dueAccounting',Z:'restored',AA:'restoredAmount',AB:'reimbursedAmount',AC:'accountedAmount',AD:'decisionsSent',AE:'decisionsExecuted',AF:'recommendationsSent',AG:'recommendationsExecuted',AH:'lawEnforcementCount',AI:'lawEnforcementAmount',AJ:'adminPersons',AK:'adminFine',AL:'adminPaid',AM:'disciplinePersons',AN:'dismissedPersons',AO:'staff',AP:'actualStaff',AQ:'certifiedStaff',AR:'qcTotal',AS:'qcCompliant',AT:'qcRemarks',AU:'qcNoncompliant'},
 mio:{C:'annualPlan',D:'halfYearPlan',E:'planCovered',F:'planRatio',G:'unplanned',I:'auditCount',J:'asCount',K:'aeCount',L:'combinedCount',M:'quarterCount',N:'quarterAsCount',O:'quarterAeCount',P:'quarterCombinedCount',Q:'coverage',R:'violations',S:'financial',T:'procedural',U:'procurementCoverage',V:'procurementFinancialAffected',W:'procurementProceduralAffected',X:'procurementFinancialUnaffected',Y:'procurementProceduralUnaffected',Z:'due',AA:'dueRestore',AB:'dueReimburse',AC:'dueAccounting',AD:'restored',AE:'restoredAmount',AF:'reimbursedAmount',AG:'accountedAmount',AH:'decisionsSent',AI:'decisionsExecuted',AJ:'recommendationsSent',AK:'recommendationsExecuted',AL:'lawEnforcementCount',AM:'lawEnforcementAmount',AN:'adminPersons',AO:'adminFine',AP:'adminPaid',AQ:'disciplinePersons',AR:'dismissedPersons',AS:'staff',AT:'actualStaff',AU:'certifiedStaff',AV:'qcTotal',AW:'qcCompliant',AX:'qcRemarks',AY:'qcNoncompliant'},
 dp:{C:'annualPlan',D:'quarterPlan',E:'planCovered',F:'planRatio',I:'auditCount',J:'asCount',K:'aeCount',L:'combinedCount',M:'coverage',N:'violations',O:'financial',P:'procedural',Q:'procurementCoverage',R:'procurementFinancialAffected',S:'procurementProceduralAffected',T:'procurementFinancialUnaffected',U:'procurementProceduralUnaffected',V:'due',W:'dueRestore',X:'dueReimburse',Y:'dueAccounting',Z:'dueCompliance',AA:'restored',AB:'restoredAmount',AC:'reimbursedAmount',AD:'accountedAmount',AE:'complianceAmount',AF:'decisionsSent',AG:'decisionsExecuted',AH:'recommendationsSent',AI:'recommendationsExecuted',AJ:'lawEnforcementCount',AK:'lawEnforcementAmount',AL:'adminPersons',AM:'adminFine',AN:'adminPaid',AO:'disciplinePersons',AP:'dismissedPersons',AQ:'staff',AR:'actualStaff',AS:'certifiedStaff',AT:'qcTotal',AU:'qcCompliant',AV:'qcRemarks',AW:'qcNoncompliant'},
 summary:{C:'annualPlan',D:'amendedPlan',E:'planCovered',F:'unplanned',G:'auditCount',H:'asCount',I:'aeCount',J:'coverage',K:'violations',L:'financial',M:'procedural',N:'procurementCoverage',O:'procurementFinancialAffected',P:'procurementProceduralAffected',Q:'procurementFinancialUnaffected',R:'procurementProceduralUnaffected',S:'due',T:'dueRestore',U:'dueReimburse',V:'dueAccounting',W:'restored',X:'restoredAmount',Y:'reimbursedAmount',Z:'accountedAmount',AA:'decisionsSent',AB:'decisionsExecuted',AC:'recommendationsSent',AD:'recommendationsExecuted',AE:'lawEnforcementCount',AF:'lawEnforcementAmount',AG:'adminPersons',AH:'adminFine',AI:'adminPaid',AJ:'disciplinePersons',AK:'dismissedPersons',AL:'staff',AM:'actualStaff',AN:'certifiedStaff',AO:'qcTotal',AP:'qcCompliant',AQ:'qcRemarks',AR:'qcNoncompliant'}
};
const metricKeys=[...new Set(Object.values(maps).flatMap(Object.values))];
const institutionKeys=['annualPlan','amendedPlan','halfYearPlan','quarterPlan','staff','actualStaff','certifiedStaff'];
function unique(source){
 const seen=new Map();
 for(const record of source){
  const key=`${record.module}:${record.id}`;
  if(seen.has(key)&&JSON.stringify(seen.get(key))!==JSON.stringify(record))throw new Error('Противоречивые записи одного дела СВА.');
  seen.set(key,record);
 }
 return [...seen.values()];
}
function type(record){return record.cooperation?.auditType||({'Соответствие':'АС','Эффективность':'АЭ','Соответствие и эффективность':'АС+АЭ'}[record.kind]);}
function counts(items){
 const known=items.every(record=>['АС','АЭ','АС+АЭ'].includes(type(record)));
 return {auditCount:items.length,asCount:known?items.filter(r=>type(r)==='АС').length:null,aeCount:known?items.filter(r=>type(r)==='АЭ').length:null,combinedCount:known?items.filter(r=>type(r)==='АС+АЭ').length:null};
}
function institutionFacts(items,to){
 const candidates=items.filter(r=>r.cooperation?.institutionIndicators&&(r.cooperation.asOf||r.date)<=to);
 if(!candidates.length)return {};
 const latest=candidates.map(r=>r.cooperation.asOf||r.date).sort().at(-1);
 const snapshots=candidates.filter(r=>(r.cooperation.asOf||r.date)===latest).map(r=>r.cooperation.institutionIndicators);
 if(snapshots.some(f=>JSON.stringify(f)!==JSON.stringify(snapshots[0])))throw new Error('Противоречивые показатели одной СВА на отчетную дату.');
 return snapshots[0];
}
function measures(items,filters){
 if(!items.length)return null;
 const result=Object.fromEntries(metricKeys.map(key=>[key,sum(items.map(r=>r.cooperation?.auditIndicators?.[key]))]));
 Object.assign(result,counts(items));
 for(const key of ['coverage','financial','procedural','due','restored'])result[key]=sum(items.map(r=>r[key]));
 result.violations=add(result.financial,result.procedural);
 const snapshots=institutionFacts(items,filters.to);
 for(const key of institutionKeys)result[key]=numeric(snapshots[key])?snapshots[key]:null;
 const quarter=Math.floor((Number(filters.to.slice(5,7))-1)/3),year=filters.to.slice(0,4);
 const quarterly=counts(items.filter(r=>r.date.startsWith(year)&&Math.floor((Number(r.date.slice(5,7))-1)/3)===quarter));
 for(const [key,value]of Object.entries(quarterly))result[`quarter${key==='auditCount'?'Count':key[0].toUpperCase()+key.slice(1)}`]=value;
 result.planRatio=ratio(result.planCovered,result.annualPlan);
 result.qcTotal=sum([result.qcCompliant,result.qcRemarks,result.qcNoncompliant]);
 return result;
}
function combine(groups){
 const present=groups.filter(Boolean);if(!present.length)return null;
 const result=Object.fromEntries(metricKeys.map(key=>[key,sum(present.map(g=>g[key]))]));
 result.planRatio=ratio(result.planCovered,result.annualPlan);
 return result;
}
function periodHeaders(layout,key,filters){
 const date=d=>d.split('-').reverse().join('.'),year=filters.to.slice(0,4),quarter=Math.ceil(Number(filters.to.slice(5,7))/3);
 const end=new Date(`${filters.to}T00:00:00Z`),month=Number(filters.to.slice(5,7));
 const wholeMonths=filters.from===`${year}-01-01`&&new Date(Date.UTC(Number(year),month,0)).getUTCDate()===end.getUTCDate();
 const period=wholeMonths?`за ${month} месяцев ${year} г.`:`за период с ${date(filters.from)} по ${date(filters.to)}`;
 const title={cgo:'B1',mio:'L1',dp:'B3',summary:'B1'}[key];layout.cells[title]=`Отчет ${period}`;
 const plan={cgo:'C2',mio:'C2',dp:'C4',summary:'C2'}[key];layout.cells[plan]=String(layout.cells[plan]).replace(/20\d\d/g,year);
 const quality={cgo:'AR2',mio:'AV2',dp:'AT4',summary:'AO2'}[key];layout.cells[quality]=`Контроль качества ${period}`;
 if(key==='cgo')layout.cells.I1=`Контроль качества ${period}`;
 if(key==='mio'){layout.cells.I2=`Проведено аудиторских мероприятий ${period}`;layout.cells.M2=`${quarter} квартал ${year} г.`;}
 if(key==='dp'){layout.cells.D3=`${quarter} квартал`;layout.cells.E3=`${year}г.`;layout.cells.D4=`Перечень ${quarter} кв`;}
 // MIO D2 is an explicitly historical first-half-year column in the sample.
 // Keep its caption and require its separately supplied institution indicator.
}
function makeSheet(schema,groups,total,filters){
 const layout=structuredClone(schema.templateLayout),mapping=maps[schema.key];periodHeaders(layout,schema.key,filters);
 const entries=[...schema.dataRows.map((row,i)=>({row,metrics:groups[i]})),...schema.totalRows.map(row=>({row,metrics:total}))];
 for(const {row,metrics}of entries){
  if(!metrics)continue;
  for(const [column,key]of Object.entries(mapping))layout.cells[`${column}${row.sourceRow}`]=display(metrics[key]);
 }
 const columns=schema.columns.map(c=>({id:c.letter,label:c.labels.join(' · ')||`Позиция ${c.letter}`,labels:c.labels,available:Boolean(mapping[c.letter])||['A','B'].includes(c.letter)}));
 const rows=entries.map(({row})=>Array.from({length:schema.columnCount},(_,i)=>layout.cells[`${col(i+1)}${row.sourceRow}`]??null));
 return {id:schema.id,name:schema.name,sourceSheetName:schema.sourceSheetName,columns,rows,headerCells:schema.headerCells,headerDepth:schema.headerDepth,merges:schema.merges,templateLayout:layout};
}
export function generateCooperationReport(form,config,sourceRecords=records){
 const filters={...defaultFilters(),...config.filters};
 let source=unique(sourceRecords);
 if(sourceRecords===records)source=source.map(r=>r.module==='СВА'?{...r,cooperation:{category:'МИО',institutionId:demoInstitutions[r.region]}}:r);
 const items=filterRecords(source,{sources:['СВА'],filters}).filter(r=>r.status==='Завершено'&&r.reportIncluded==='Да');
 const details=form.sheets.filter(s=>s.key!=='summary');
 for(const item of items){const s=details.find(s=>s.category===item.cooperation?.category);if(!s?.dataRows.some(r=>r.id===item.cooperation?.institutionId))throw new Error(`Для дела «${item.id}» не указана СВА из строк исходного отчета.`);}
 const totals=new Map(),sheets=[];
 for(const schema of details){
  const groups=schema.dataRows.map(row=>measures(items.filter(r=>r.cooperation.category===schema.category&&r.cooperation.institutionId===row.id),filters));
  const total=combine(groups);totals.set(schema.category,total);sheets.push(makeSheet(schema,groups,total,filters));
 }
 const summary=form.sheets.find(s=>s.key==='summary'),groups=summary.dataRows.map(row=>totals.get(row.label));
 sheets.push(makeSheet(summary,groups,combine(groups),filters));
 return {config,createdAt:new Date().toISOString(),recordCount:items.length,objectCount:new Set(items.map(r=>r.bin).filter(Boolean)).size,sheets};
}
