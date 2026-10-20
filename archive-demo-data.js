import {records} from './data.js';

// Explicit, reproducible teaching events. These are not customer workbook rows,
// production data, or evidence that the corresponding API fields already exist.
const addDays=(value,days)=>{const date=new Date(`${value}T00:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);};
const split=(amount)=>{const a=Math.floor(amount*.4),b=Math.floor(amount*.3),c=Math.floor(amount*.2);return [a,b,c,amount-a-b-c];};
const measures=['restore','reimburse','account','conform'];
const disciplineTypes=['Замечание','Выговор','Строгий выговор','Освобождение от должности'];
export const archiveDemoFacts={cases:[],violations:[],executions:[],cancellations:[],administrative:[],disciplinary:[]};
for(const [index,r] of records.filter(r=>r.module==='ВГА').entries()){
 const category=index%2?'procurement':'other',basis=['Перечень','СУР','Обращения физических и юридических лиц'][index%3];
 archiveDemoFacts.cases.push({caseId:r.id,category,basis,objectType:'Государственное учреждение',budgetLevel:index%2?'Республиканский бюджет':'Местный бюджет',abpName:`Учебный АБП ${r.abp}`,programName:`Учебная бюджетная программа ${r.program}`,functionalCode:String(index%3+1).padStart(2,'0'),functionalName:`Учебная функциональная группа ${index%3+1}`,orderNumber:`УЧ-${r.id}`,reportDate:r.date,approvalDate:r.status==='Завершено'?r.date:null,riskYear:r.date.slice(0,4),budgetCoverage:r.coverage,assetCoverage:0,procurementCoverage:category==='procurement'?r.coverage:0,procurementLots:category==='procurement'?index%4+1:0});
 const due=split(r.financial),executed=split(r.restored);
 for(let j=0;j<measures.length;j++){
  const violationId=`DEMO-VIOL-${r.id}-${measures[j]}`;
  if(due[j]>0)archiveDemoFacts.violations.push({id:violationId,caseId:r.id,date:r.date,category,measure:measures[j],amount:due[j],description:`Учебный пример: ${category==='procurement'?'государственные закупки':'прочие нарушения'}`});
  if(executed[j]>0)archiveDemoFacts.executions.push({id:`DEMO-EXEC-${r.id}-${j}`,caseId:r.id,violationId,measure:measures[j],amount:executed[j],date:addDays(r.date,2),confirmedAt:addDays(r.date,3),status:'Подтверждено'});
 }
 // An explicit cancellation fits the still outstanding amount; it is never
 // inferred from an objection count or repeated for every execution.
 const cancelMeasure=index%4,cancelAmount=index%3===0?Math.min(Math.floor(r.financial*.05),due[cancelMeasure]-executed[cancelMeasure]):0;
 if(cancelAmount>0)archiveDemoFacts.cancellations.push({id:`DEMO-CANCEL-${r.id}`,caseId:r.id,violationId:`DEMO-VIOL-${r.id}-${measures[cancelMeasure]}`,measure:measures[cancelMeasure],amount:cancelAmount,date:addDays(r.date,4),confirmedAt:addDays(r.date,4),status:'Подтверждено'});
 if(r.financial>0&&index%3===1){const amount=50+index*5;archiveDemoFacts.administrative.push({id:`DEMO-ADMIN-${r.id}`,caseId:r.id,date:addDays(r.date,3),person:`Учебный сотрудник ${index+1}`,position:index%2?'Руководитель':'Специалист',isHead:Boolean(index%2),article:'Учебная статья',iin:`9901${String(index+1).padStart(8,'0')}`,amount,paid:index%2?amount:Math.floor(amount/2)});}
 if(r.financial>0&&index%4<2)archiveDemoFacts.disciplinary.push({id:`DEMO-DISC-${r.id}`,caseId:r.id,date:addDays(r.date,4),person:`Учебный сотрудник ${index+1}`,position:index%2?'Руководитель':'Специалист',isHead:Boolean(index%2),type:disciplineTypes[Math.floor(index/4)%disciplineTypes.length]});
}

export const archiveMeasureTypes=measures;
