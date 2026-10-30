import {records} from './data.js';

// Synthetic facts made for the demo. These are not observations from uploaded
// workbooks and are never attached to caller-provided production/custom records.
const date=(year,month,day)=>`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
export const receivedDemoFacts=Object.fromEntries(records.filter(row=>row.module==='ВГА').map((row,index)=>{
 const quarter=Math.floor(index/6)+1,month=(quarter-1)*3+1;
 const assignedAt=index%5===0?null:date(2026,month,5+index%7);
 const completedAt=assignedAt&&index%3!==1?date(2026,month+1,12+index%9):null;
 const excludedAt=index===7?'2026-05-20':null;
 return [row.id,{
  plan:{year:2026,quarter,coverage:(index+10)*15000,kind:row.kind,event:`Учебное аудиторское мероприятие ${index+1}`,assignedAt,completedAt,excludedAt,exclusionReason:excludedAt?'Изменение учебного перечня':null,orderNumber:assignedAt?`ПР-ДЕМО-${index+1}`:null},
  assignmentDecisions:[{id:`DECISION-DEMO-${index+1}`,date:date(2026,Number(row.date.slice(5,7)),20),result:index%4===0?'Отклонено':'Подтверждено',reason:index%4===0?'Уточнение предмета учебного поручения':null}],
  qualityChecks:[{id:`QC-DEMO-${index+1}`,date:date(2026,Number(row.date.slice(5,7)),24),result:index%3===0?'Не соответствуют Стандартам ГАФК':'Соответствуют Стандартам ГАФК',reviewer:`Специалист КК ${index%6+1}`,responsible:`Руководитель группы ${index%6+1}`,basis:'Плановый контроль качества (учебный пример)',reportNumber:`АО-ДЕМО-${index+1}`,reportDate:row.date,caseCreatedAt:row.date}]
 }];
}));
