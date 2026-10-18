// Fully synthetic teaching fixture. No customer records or live API access.
export const linkedFacts = {
  cases: [
    {id:'VGA-LINK-001',bin:'990000000001',object:'ГУ «Учебный объект А»',region:'г. Астана',organ:'ДВГА · г. Астана',date:'2026-09-01',assessmentId:'RISK-001',coverage:10000},
    {id:'VGA-LINK-002',bin:'990000000001',object:'ГУ «Учебный объект А»',region:'г. Астана',organ:'ДВГА · г. Астана',date:'2026-09-10',assessmentId:'RISK-002',coverage:6000},
    {id:'VGA-LINK-003',bin:'990000000002',object:'ГУ «Учебный объект Б»',region:'г. Алматы',organ:'ДВГА · г. Алматы',date:'2026-09-15',assessmentId:null,coverage:3000}
  ],
  assessments: [
    {id:'RISK-001',bin:'990000000001',date:'2026-08-01',score:85,risk:'Высокий'},
    {id:'RISK-002',bin:'990000000001',date:'2026-08-20',score:55,risk:'Средний'}
  ],
  violations: [
    {id:'VIOL-001',caseId:'VGA-LINK-001',date:'2026-09-03',amount:1000},
    {id:'VIOL-002',caseId:'VGA-LINK-001',date:'2026-09-03',amount:500},
    {id:'VIOL-003',caseId:'VGA-LINK-002',date:'2026-09-12',amount:800}
  ],
  executions: [
    {id:'PAY-001',violationId:'VIOL-001',date:'2026-09-10',confirmedAt:'2026-09-11',amount:100,status:'Подтверждено'},
    {id:'PAY-002',violationId:'VIOL-001',date:'2026-09-16',confirmedAt:'2026-09-16',amount:200,status:'Подтверждено'},
    {id:'PAY-003',violationId:'VIOL-002',date:'2026-09-18',confirmedAt:'2026-09-19',amount:200,status:'Подтверждено'},
    {id:'PAY-004',violationId:'VIOL-003',date:'2026-09-20',confirmedAt:'2026-09-21',amount:100,status:'Подтверждено'},
    {id:'PAY-005',violationId:'VIOL-001',date:'2026-09-22',amount:150,status:'На проверке'},
    {id:'PAY-006',violationId:'VIOL-003',date:'2026-10-05',confirmedAt:'2026-10-06',amount:50,status:'Подтверждено'}
  ],
  objections: [
    {id:'OBJ-001',sourceModule:'ВГА',caseId:'VGA-LINK-001',date:'2026-09-05'},
    {id:'OBJ-002',sourceModule:'ВГА',caseId:'VGA-LINK-001',date:'2026-09-06'}
  ],
  cancellations: [
    {id:'CANCEL-001',objectionId:'OBJ-001',violationId:'VIOL-001',date:'2026-09-20',confirmedAt:'2026-09-21',amount:200,status:'Подтверждено'}
  ]
};

const extra=(id,label,type='text',aggregation=null)=>({id,label,type,aggregation,source:'Связанные данные по делу',available:['ВГА'],dataset:'case-links'});
export const linkedFields=[
  extra('assessmentId','Связанный расчёт СУР'),
  extra('violationCount','Нарушения, кол-во','integer','sum'),
  extra('objectionCount','Возражения, кол-во','integer','sum'),
  extra('cancelled','Отменено по возражениям, тыс. ₸','number','sum'),
  extra('balance','Не устранено на дату, тыс. ₸','number','sum'),
  extra('linkState','Связь с расчётом СУР')
];
export const linkedFieldIds=['id','date','region','organ','object','bin','coverage','financial','restored','risk','score','assessmentId','violationCount','objectionCount','cancelled','balance','linkState','count','objectCount','month'];
export const linkedDefaultColumns=['id','object','assessmentId','risk','violationCount','financial','restored','objectionCount','cancelled','balance'];

function unique(items){
  const byId=new Map();
  for(const item of items){
    if(!item.id)throw new Error('В источнике отсутствует идентификатор записи.');
    const old=byId.get(item.id);
    if(old&&JSON.stringify(old)!==JSON.stringify(item))throw new Error('Конфликт версий записи '+item.id);
    byId.set(item.id,item);
  }
  return [...byId.values()];
}
const sum=items=>items.reduce((total,x)=>total+x.amount,0);
const confirmed=(r,asOf)=>r.status==='Подтверждено'&&r.date<=asOf&&r.confirmedAt&&r.confirmedAt<=asOf;

// Aggregate children before combining them. A flat many-to-many join would
// repeat violations/payments once per objection and overstate the totals.
export function joinAuditFacts(facts=linkedFacts,asOf='2026-09-30'){
  const cases=unique(facts.cases),risks=unique(facts.assessments),violations=unique(facts.violations),payments=unique(facts.executions),objections=unique(facts.objections),cancellations=unique(facts.cancellations);
  return cases.filter(c=>c.date<=asOf).map(c=>{
    const risk=risks.find(r=>r.id===c.assessmentId&&r.bin===c.bin&&r.date<=asOf);
    const vs=violations.filter(v=>v.caseId===c.id&&v.date<=asOf),vids=new Set(vs.map(v=>v.id));
    const ps=payments.filter(p=>vids.has(p.violationId)&&confirmed(p,asOf));
    const os=objections.filter(o=>o.sourceModule==='ВГА'&&o.caseId===c.id&&o.date<=asOf),oids=new Set(os.map(o=>o.id));
    const cs=cancellations.filter(x=>vids.has(x.violationId)&&oids.has(x.objectionId)&&confirmed(x,asOf));
    const financial=sum(vs),restored=sum(ps),cancelled=sum(cs);
    for(const v of vs){if(sum(ps.filter(p=>p.violationId===v.id))+sum(cs.filter(x=>x.violationId===v.id))>v.amount)throw new Error('Исполнение и отмена превышают сумму нарушения '+v.id);}
    return {...c,module:'ВГА',month:c.date.slice(0,7),risk:risk?.risk??null,score:risk?.score??null,financial,restored,cancelled,balance:financial-restored-cancelled,violationCount:vs.length,objectionCount:os.length,linkState:risk?'Расчёт связан':c.assessmentId?'Расчёт недоступен':'Связь не задана',_lineage:{violations:vs.map(x=>x.id),executions:ps.map(x=>x.id),objections:os.map(x=>x.id),cancellations:cs.map(x=>x.id),assessment:risk?.id??null}};
  });
}
