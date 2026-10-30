import {records, defaultFilters} from './data.js';
import {archiveForms} from './form-registry.js';
import {archiveDemoFacts, archiveMeasureTypes} from './archive-demo-data.js';
import {filterRecords} from './engine.js';
import {generateReceivedReport,receivedReportDescriptions} from './received-engine.js';
import {generateProfessionalReport,professionalReportDescriptions} from './professional-engine.js';

export const ARCHIVE_MISSING='Нет данных';
const formById=new Map(archiveForms.map(f=>[f.id,f]));
const normalize=s=>String(s??'').toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/\s+/g,' ').trim();
const sum=(items,key)=>items.every(r=>typeof r[key]==='number'&&Number.isFinite(r[key]))?items.reduce((n,r)=>n+r[key],0):null;
const ratio=(a,b)=>typeof a==='number'&&typeof b==='number'&&b>0?Math.round(a/b*10000)/100:null;
const value=v=>v==null||v===''?ARCHIVE_MISSING:v;
const baseKeys=new Set(['id','organ','organCode','date','month','reportIncluded','auditor','object','bin','abp','program','coverage','financial','procedural','procedureCount','due','restored','orders','executed','deadline','count','objectCount','index','electronicCount','ordersRatio']);
const demoKeys=new Set(['basis','budgetLevel','abpName','programName','functionalCode','functionalName','orderNumber','reportDate','approvalDate','riskYear','budgetCoverage','assetCoverage','procurementCoverage','procurementLots','procurementFinancial','procurementProcedural','otherFinancial','otherProcedural','descriptionFinancial','descriptionProcedural','executedTotal','cancelledTotal','adminCount','adminPersons','adminFine','adminPaid','disciplineCount','dismissedCount','heads','employees','headRemark','headReprimand','headStrict','headDismissal','employeeRemark','employeeReprimand','employeeStrict','employeeDismissal','person','position','type','article','iin','eventDate','isHead','isEmployee','fine','paid']);
for(const m of archiveMeasureTypes)for(const p of ['due','exec','cancel','balance','period_exec','period_cancel'])demoKeys.add(`${p}_${m}`);
const provenance=k=>!k?'unavailable':baseKeys.has(k)?'existing-demo-record':'demo-fixture';

export function archiveConfig(formId,filters=defaultFilters()){
 const form=formById.get(formId);if(!form)throw new Error('Неизвестная архивная форма.');
 const normalized={...defaultFilters(),...filters};if(form.uaoNumber===20)normalized.format='Электронный';
 const description=receivedReportDescriptions[form.id]||professionalReportDescriptions[form.id]||{};
 return {name:form.name,dataset:'archive',archiveFormId:form.id,reportId:form.id,filters:normalized,sources:form.sources||['ВГА'],group:'none',columns:[],...description};
}
export function validateArchiveFilters(filters){
 const f=filters||{};
 if(!/^\d{4}-\d{2}-\d{2}$/.test(f.from)||!/^\d{4}-\d{2}-\d{2}$/.test(f.to))return 'Укажите начало и конец периода.';
 for(const d of [f.from,f.to]){const date=new Date(`${d}T00:00:00Z`);if(!Number.isFinite(+date)||date.toISOString().slice(0,10)!==d)return 'Проверьте даты периода.';}
 if(f.from>f.to)return 'Начало периода не может быть позже окончания.';
 if(f.minFinancial!==''&&f.minFinancial!=null&&(!Number.isFinite(Number(f.minFinancial))||Number(f.minFinancial)<0))return 'Сумма нарушений должна быть неотрицательным числом.';
 const allowed=Object.keys(defaultFilters());
 if(Object.keys(f).some(k=>!allowed.includes(k)))return 'Неизвестный фильтр отчета.';
 if(f.risk||f.decision)return 'В архивных формах ВГА эти фильтры недоступны.';
 for(const k of ['region','organ','status','query','format','kind','included'])if(f[k]!=null&&typeof f[k]!=='string')return 'Проверьте параметры фильтров.';
 if(f.onlyOverdue!=null&&typeof f.onlyOverdue!=='boolean')return 'Проверьте признак просрочки.';
 return '';
}
function deduplicate(source){
 const seen=new Map();for(const r of source){if(r.module!=='ВГА')continue;const k=r.id;if(!k)throw new Error('У дела отсутствует идентификатор.');if(seen.has(k)&&JSON.stringify(seen.get(k))!==JSON.stringify(r))throw new Error(`Противоречивые данные дела ${k}.`);seen.set(k,r);}return [...seen.values()];
}
function enrich(r,from,to,withDemo){
 const out={...r,count:1,objectCount:r.bin?1:0,month:Number(r.date.slice(5,7)),electronicCount:r.format==='Электронный'?1:0};
 if(!withDemo)return out;
 const meta=archiveDemoFacts.cases.find(x=>x.caseId===r.id);if(!meta)return out;Object.assign(out,meta);
 const children=(name,confirmed=false)=>archiveDemoFacts[name].filter(x=>x.caseId===r.id&&x.date<=to&&(!confirmed||(x.status==='Подтверждено'&&x.confirmedAt<=to)));
 const violations=children('violations'),ids=new Set(violations.map(v=>v.id));
 const executions=children('executions',true).filter(e=>ids.has(e.violationId));
 const cancellations=children('cancellations',true).filter(e=>ids.has(e.violationId));
 for(const m of archiveMeasureTypes){
  out[`due_${m}`]=violations.filter(v=>v.measure===m).reduce((s,v)=>s+v.amount,0);
  out[`exec_${m}`]=executions.filter(v=>v.measure===m).reduce((s,v)=>s+v.amount,0);
  out[`cancel_${m}`]=cancellations.filter(v=>v.measure===m).reduce((s,v)=>s+v.amount,0);
  out[`period_exec_${m}`]=executions.filter(v=>v.measure===m&&v.date>=from).reduce((s,v)=>s+v.amount,0);
  out[`period_cancel_${m}`]=cancellations.filter(v=>v.measure===m&&v.date>=from).reduce((s,v)=>s+v.amount,0);
  out[`balance_${m}`]=out[`due_${m}`]-out[`exec_${m}`]-out[`cancel_${m}`];
 }
 out.executedTotal=executions.reduce((s,v)=>s+v.amount,0);out.cancelledTotal=cancellations.reduce((s,v)=>s+v.amount,0);
 for(const category of ['procurement','other']){out[`${category}Financial`]=meta.category===category?r.financial:0;out[`${category}Procedural`]=meta.category===category?r.procedural:0;}
 out.descriptionFinancial=violations.map(v=>v.description).filter((v,i,a)=>a.indexOf(v)===i).join('; ')||'Нарушений не установлено';
 out.descriptionProcedural=r.procedural?'Учебное нарушение процедурного характера':'Нарушений не установлено';
 out._administrative=children('administrative');out._disciplinary=children('disciplinary');
 out.adminCount=out._administrative.length;out.adminPersons=new Set(out._administrative.map(e=>e.iin)).size;out.adminFine=sum(out._administrative,'amount');out.adminPaid=sum(out._administrative,'paid');
 out.disciplineCount=new Set(out._disciplinary.map(e=>e.person)).size;out.dismissedCount=out._disciplinary.filter(e=>e.type==='Освобождение от должности').length;
 for(const [prefix,isHead]of [['head',true],['employee',false]])for(const [suffix,type]of [['Remark','Замечание'],['Reprimand','Выговор'],['Strict','Строгий выговор'],['Dismissal','Освобождение от должности']])out[prefix+suffix]=out._disciplinary.filter(e=>e.isHead===isHead&&e.type===type).length;
 out.heads=out._disciplinary.filter(e=>e.isHead).length;out.employees=out._disciplinary.filter(e=>!e.isHead).length;
 return out;
}
const sumKeys=['coverage','financial','procedural','procedureCount','due','restored','orders','executed','electronicCount',...demoKeys].filter(k=>!['basis','budgetLevel','abpName','programName','functionalCode','functionalName','orderNumber','reportDate','approvalDate','riskYear','descriptionFinancial','descriptionProcedural','person','position','type','article','iin','eventDate'].includes(k));
function summarize(items){
 const out={_items:items,count:items.length,objectCount:new Set(items.map(r=>r.bin).filter(Boolean)).size};
 for(const k of sumKeys)out[k]=sum(items,k);
 out.ordersRatio=ratio(out.executed,out.orders);
 return out;
}
function group(items,keys){const groups=new Map();for(const r of items){const k=JSON.stringify(keys.map(k=>r[k]??null));if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);}return [...groups.values()].map(items=>({...summarize(items),...Object.fromEntries(keys.map(k=>[k,items[0][k]])),organCode:items[0].organCode}));}
const maps={
 'uao-discipline-persons':{A:'index',B:'id',C:'object',D:'person',E:'position',F:'type'},
 'uao-discipline-summary':{B:'index',C:'id',D:'auditor',E:'basis',F:'object',G:'disciplineCount',H:'heads',I:'headRemark',J:'headReprimand',K:'headStrict',L:'headDismissal',M:'employees',N:'employeeRemark',O:'employeeReprimand',P:'employeeStrict',Q:'employeeDismissal'},
 'uao-administrative':{A:'index',B:'id',C:'object',D:'person',E:'iin',F:'position',G:'isHead',H:'isEmployee',I:'article',J:'eventDate',K:'fine',L:'paid'},
 'uao-operplan':{A:'index',B:'organ',C:'count',H:'financial',I:'due_restore',J:'due_reimburse',K:'due_account',L:'executedTotal',M:'exec_restore',N:'exec_reimburse',O:'exec_account',R:'orders',S:'executed',U:'ordersRatio'},
 'uao-operplan-violations':{A:'index',B:'organ',C:'financial',D:'due_restore',E:'due_reimburse',F:'due_account',G:'executedTotal',H:'exec_restore',I:'exec_reimburse',J:'exec_account'},
 'uao-operplan-orders':{A:'index',B:'organ',C:'orders',D:'executed',F:'ordersRatio'},
 'uao-residuals':{A:'index',B:'id',C:'auditor',D:'object',E:'coverage',F:'budgetCoverage',G:'assetCoverage',H:'procurementCoverage',I:'due_reimburse',J:'due_restore',K:'due_account',L:'exec_reimburse',M:'exec_restore',N:'exec_account',O:'balance_reimburse',P:'balance_restore',Q:'balance_account',R:'cancel_reimburse',S:'cancel_restore',T:'cancel_account',U:'descriptionFinancial',V:'descriptionFinancial',X:'deadline'},
 'uao-residuals-years':{A:'index',B:'id',C:'object',D:'due_reimburse',E:'period_exec_reimburse',F:'period_cancel_reimburse',G:'balance_reimburse'},
 'uao-violation-types':{B:'index',C:'orderNumber',D:'basis',E:'id',F:'reportDate',G:'approvalDate',H:'object',I:'bin',J:'organCode',K:'abpName',L:'abp',M:'program',N:'programName',O:'riskYear',P:'coverage',Q:'budgetCoverage',R:'assetCoverage',S:'procurementCoverage',T:'financial',U:'procedural',V:'procedureCount',CS:'procurementFinancial',CT:'procurementProcedural',GI:'otherFinancial',GJ:'otherProcedural',GK:'due',GL:'due_restore',GM:'due_reimburse',GN:'due_account',GO:'due_conform',GP:'executedTotal',GQ:'exec_restore',GR:'exec_reimburse',GS:'exec_account',GT:'exec_conform',GU:'cancelledTotal'},
 'uao-other-violations':{B:'index',C:'id',D:'orderNumber',E:'basis',F:'reportDate',G:'approvalDate',H:'object',I:'bin',J:'organCode',K:'abpName',L:'abp',M:'program',N:'programName',O:'riskYear',P:'coverage',Q:'budgetCoverage',R:'assetCoverage',S:'procurementCoverage',T:'otherFinancial',U:'descriptionFinancial',V:'otherProcedural',W:'descriptionProcedural',X:'due',Y:'due_restore',Z:'due_reimburse',AA:'due_account',AB:'due_conform',AC:'executedTotal',AD:'exec_restore',AE:'exec_reimburse',AF:'exec_account',AG:'exec_conform'},
 'uao-procurement':{C:'index',D:'basis',E:'count',F:'procurementLots',G:'procurementCoverage',L:'orders',N:'executed',P:'due',Q:'due_restore',R:'due_reimburse',S:'executedTotal',T:'exec_restore',U:'exec_reimburse',V:'exec_account',W:'exec_conform',Z:'adminCount',AA:'adminPersons',AB:'adminFine',AC:'adminPaid',AD:'disciplineCount',AE:'dismissedCount'},
 'uao-grounds':{B:'index',C:'organ',D:'count',E:'financial',F:'procedural'},
 'uao-functional':{B:'index',C:'functionalCode',D:'budgetLevel',E:'functionalName',F:'objectCount',G:'coverage',H:'financial',I:'procedural',AB:'procurementLots',AC:'procurementCoverage',AN:'otherFinancial',AO:'otherProcedural',AP:'due',AQ:'due_restore',AR:'due_reimburse',AS:'due_account',AT:'due_conform',AU:'executedTotal',AV:'exec_restore',AW:'exec_reimburse',AX:'exec_account',AY:'exec_conform',AZ:'cancelledTotal'},
 'uao-budget-principles':{A:'abp',B:'abpName'},
 'uao-budget-violations':{A:'abp',B:'abpName',C:'count',D:'financial',E:'procedural',H:'procurementFinancial',K:'otherFinancial'}
};
const grounds=[['G','H','I','Перечень'],['J','K','L','Поручение Президента'],['M','N','O','Инвестиционные проекты'],['P','Q','R','Проверки на соответствие'],['S','T','U','Камеральный контроль'],['V','W','X','ОПИ'],['Y','Z','AA','СУР'],['AB','AC','AD','Обращения физических и юридических лиц'],['AE','AF','AG','Перенаправленные обращения'],['AH','AI','AJ','Запрос правоохранительных органов'],['AK','AL','AM','Частное определение суда'],['AN','AO','AP','Прочие']];
for(const [count,financial,procedural,basis]of grounds){maps['uao-grounds'][count]=`basis:${basis}:count`;maps['uao-grounds'][financial]=`basis:${basis}:financial`;maps['uao-grounds'][procedural]=`basis:${basis}:procedural`;}
function wideKey(column){
 const labels=column.labels.map(normalize),path=labels.join(' > '),leaf=labels.at(-1)||'';
 const identities={'№п /п':'index','№ п/п':'index','номер дела вга':'id','номер дела эга':'id','орган аудита':'organCode','месяц':'month','включен в отчетность':'reportIncluded','автор (полная рабочая группа)':'auditor','№ приказа (поручения)':'orderNumber','основание для проведения аудиторского мероприятия':'basis','отчетная дата':'date','дата аудиторского заключения (утверждение)':'approvalDate','наименование объекта аудита':'object','бин объекта аудита':'bin','код абп':'abp','наименование абп':'abpName','код бюджетной программы':'program','наименование бюджетной программы':'programName','уровень бюджета':'budgetLevel','год объекта риска':'riskYear'};
 if(labels.length===1&&identities[leaf])return identities[leaf];
 if(path==='объем средств, охваченных аудитом')return 'coverage';
 if(labels[0]==='объем средств, охваченных аудитом'){if(leaf==='бюджетных средств')return 'budgetCoverage';if(leaf.startsWith('активы государственного'))return 'assetCoverage';if(leaf==='общая сумма охвата по гз')return 'procurementCoverage';}
 if(labels[0]==='финансовые нарушения и нарушения процедурного характера'){
  if(labels.length===2&&leaf==='общая сумма установленных финансовых нарушений')return 'financial';
  if(labels.length===2&&leaf==='общая сумма нарушений процедурного характера')return 'procedural';
  if(leaf==='количество установленных нарушений процедурного характера')return 'procedureCount';
 }
 if(labels[0]==='из выявленных нарушений'){
  if(leaf.startsWith('общая сумма подлежащая'))return 'due';
  if(leaf.startsWith('общая сумма возмещ,'))return 'executedTotal';
  return {'восстановлению':'due_restore','возмещению':'due_reimburse','отражению по учету':'due_account','приведению в соответствие':'due_conform','восстановлено':'exec_restore','возмещено':'exec_reimburse','отражено по учету':'exec_account','приведено в соответствие':'exec_conform','отменено':'cancelledTotal'}[leaf];
 }
 if(labels[0]?.startsWith('количество направленных предписаний')){if(labels.length===1||leaf==='направлено')return 'orders';if(leaf==='из них исполнено')return 'executed';if(leaf.includes('срок'))return 'deadline';}
 // Category totals require the explicit demo classification; classifier codes,
 // budget principles and judicial subcategories intentionally remain unknown.
 if(path.includes('глава 11.')&&labels.length<=5&&!path.includes('принцип')){if(leaf.includes('финансовые нарушения')||leaf==='общая сумма установленных финансовых нарушений')return 'procurementFinancial';if(leaf.includes('процедурные нарушения')||leaf==='общая сумма установленных нарушений процедурного характера')return 'procurementProcedural';}
 if(path.includes('раздел 4. прочие')&&labels.length===3){if(leaf==='общая сумма установленных финансовых нарушений')return 'otherFinancial';if(leaf==='общая сумма установленных нарушений процедурного характера')return 'otherProcedural';}
 return undefined;
}
function mappingFor(form,sheet){
 if(form.uaoNumber===15&&sheet.kind==='table')return {A:'index',B:'organ'};
 if(maps[form.id])return maps[form.id];
 const mapping={};for(const c of sheet.columns){const k=wideKey(c);if(k)mapping[c.letter]=k;}
 if(form.id==='uao-org'){mapping.B='index';mapping.C='organCode';mapping.D='organ';mapping.E='count';}
 return mapping;
}
function prepareRows(form,items){
 if(form.id==='uao-discipline-persons')return items.flatMap(r=>(r._disciplinary||[]).map(e=>({...r,person:e.person,position:e.position,type:e.type})));
 if(form.id==='uao-administrative')return items.flatMap(r=>(r._administrative||[]).map(e=>({...r,person:e.person,position:e.position,iin:e.iin,article:e.article,eventDate:e.date,isHead:e.isHead?1:0,isEmployee:e.isHead?0:1,fine:e.amount,paid:e.paid})));
 if(form.id==='uao-discipline-summary')return items.filter(r=>r.disciplineCount>0);
 if(form.id==='uao-procurement')return group(items.filter(r=>r.category==='procurement'),['basis']);
 if(form.id==='uao-other-violations')return items.filter(r=>r.category==='other');
 if(form.id==='uao-functional')return group(items,['functionalCode','budgetLevel','functionalName']);
 if([18,19].includes(form.uaoNumber))return group(items.filter(r=>r.budgetLevel==='Республиканский бюджет'),['abp','abpName']);
 if(['uao-org','uao-grounds'].includes(form.id)||form.uaoNumber===16||form.uaoNumber===15)return group(items,['organ']);
 return items;
}
function readKey(row,key,index){
 if(!key)return null;if(key==='index')return index+1;
 if(key==='reportIncluded')return row[key]==='Да'?1:row[key]==='Нет'?0:null;
 if(key.startsWith('basis:')){const [,basis,metric]=key.split(':');if(!row._items?.every(r=>typeof r.basis==='string'))return null;const subset=row._items.filter(r=>r.basis===basis);return metric==='count'?subset.length:sum(subset,metric);}
 return row[key];
}
const socialMap={7:'count',8:'coverage',9:'financial',10:'due_restore',11:'due_reimburse',12:'due_account',13:'executedTotal',14:'exec_restore',15:'exec_reimburse',16:'exec_account',17:'procedureCount',18:'orders',19:'executed',25:'adminCount',26:'adminFine',27:'adminPaid',28:'disciplineCount'};
const budgetMap={14:'count',15:'financial',19:'procurementFinancial',22:'otherFinancial',23:'procedural',27:'procurementProcedural',30:'otherProcedural'};
function matrixFact(form,sheet,row,column,items,context){
 if(form.id==='uao-social'){
  const key=socialMap[row.sourceRow];if(!key||column!=='F')return null;
  const fact=context.total[key];return typeof fact==='number'&&normalize(row.cells.E).includes('млн')?fact/1000:fact;
 }
 if(form.id==='uao-budget-execution'){
  const key=budgetMap[row.sourceRow];if(!key)return null;
  // This form concerns the republican budget; the demo fixture explicitly sets
  // each case's funding level. Quasi-sector/transfers have no modeled source.
  if(!context.budgetKnown)return null;
  if(column==='B')return context.republican[key];
  if(column==='C'&&context.objectTypesKnown)return context.republicanInstitutions[key];return null;
 }
 if(form.uaoNumber===15&&sheet.name==='показатели'){
  const regionLabel=sheet.columns.find(c=>c.letter===column)?.labels.join(' ');
  const canonical=s=>normalize(s).replace(/^г\.?\s*/,'').replace(/ская область$/,'').replace(/область$/,'').trim();
  const regionItems=items.filter(r=>canonical(r.region)===canonical(regionLabel));if(!regionItems.length)return null;
  if(row.sourceRow===11)return regionItems.length;
  if(row.sourceRow===12)return regionItems.filter(r=>r.financial>0).length;
  if([7,8].includes(row.sourceRow)&&regionItems.every(r=>r.category))return sum(regionItems.filter(r=>r.kind!=='Финансовая отчетность'&&r.category!=='procurement'),row.sourceRow===7?'coverage':'financial');
 }
 return null;
}
function matrixSheet(form,sheet,items){
 const context={total:summarize(items),budgetKnown:items.every(r=>r.budgetLevel),objectTypesKnown:items.every(r=>r.objectType),republican:summarize(items.filter(r=>r.budgetLevel==='Республиканский бюджет')),republicanInstitutions:summarize(items.filter(r=>r.budgetLevel==='Республиканский бюджет'&&r.objectType==='Государственное учреждение'))};
 const rows=sheet.rows.map(row=>sheet.columns.map(c=>{
  if(Object.hasOwn(row.cells,c.letter))return row.cells[c.letter];
  if(row.rulePoints?.column===c.letter)return row.rulePoints.value;
  if(!row.valueColumns.includes(c.letter))return null;
  return value(matrixFact(form,sheet,row,c.letter,items,context));
 }));
 const columns=sheet.columns.map((c,i)=>({id:c.letter,label:c.labels.join(' · ')||`Позиция ${c.letter}`,labels:c.labels,group:c.labels[0]||'',available:rows.some(r=>r[i]!==null&&r[i]!==ARCHIVE_MISSING)}));
 return {id:sheet.id,name:sheet.name,columns,headerCells:sheet.headerCells,headerDepth:sheet.headerDepth,merges:sheet.merges,rows};
}
export function generateArchiveReport(formId,filters=defaultFilters(),sourceRecords=records){
 const config=archiveConfig(formId,filters),error=validateArchiveFilters(config.filters);if(error)throw new Error(error);
 const form=formById.get(formId),asOf=form.uaoNumber===21;
 if(form.engine==='received')return generateReceivedReport(form,config,sourceRecords);
 if(form.engine==='professional')return generateProfessionalReport(form,config,sourceRecords);
 const effectiveFilters=asOf?{...config.filters,from:'0001-01-01'}:config.filters;
 const filtered=filterRecords(deduplicate(sourceRecords),{sources:['ВГА'],filters:effectiveFilters});
 const items=filtered.map(r=>enrich(r,config.filters.from,config.filters.to,sourceRecords===records));
 const sheets=form.sheets.map(sheet=>{
  if(sheet.kind==='matrix')return matrixSheet(form,sheet,items);
  const mapping=mappingFor(form,sheet),data=prepareRows(form,items);
  const columns=sheet.columns.map(c=>({id:c.letter,label:c.labels.join(' · ')||`Позиция ${c.letter}`,labels:c.labels,group:c.labels[0]||'',available:Boolean(mapping[c.letter])}));
  const rows=data.map((r,i)=>sheet.columns.map(c=>!c.labels.length&&!mapping[c.letter]?null:value(readKey(r,mapping[c.letter],i))));
  return {id:sheet.id,name:sheet.name,columns,headerCells:sheet.headerCells,headerDepth:sheet.headerDepth,merges:sheet.merges,rows};
 });
 return {config,createdAt:new Date().toISOString(),recordCount:items.length,objectCount:new Set(items.map(r=>r.bin).filter(Boolean)).size,sheets};
}
export function archiveCoverage(){
 return archiveForms.map(form=>({id:form.id,uaoNumber:form.uaoNumber,name:form.name,sourceFile:form.sourceFile,sourceType:'Демонстрационные данные; подключение к боевой БД не проверено',asOf:form.uaoNumber===21,sheets:form.sheets.map(sheet=>{
  if(form.engine)return {id:sheet.id,name:sheet.name,columns:sheet.columns.filter(c=>c.labels.length).map(c=>({letter:c.letter,labels:c.labels,key:null,provenance:'form-specific-demo-adapter'}))};
  if(sheet.kind==='table'){const mapping=mappingFor(form,sheet);return {id:sheet.id,name:sheet.name,columns:sheet.columns.filter(c=>c.labels.length).map(c=>({letter:c.letter,labels:c.labels,key:mapping[c.letter]||null,provenance:provenance(mapping[c.letter])}))};}
  return {id:sheet.id,name:sheet.name,kind:'matrix',indicators:sheet.rows.filter(r=>r.valueColumns.length).map(r=>({sourceRow:r.sourceRow,label:r.label,key:form.id==='uao-social'?socialMap[r.sourceRow]||null:form.id==='uao-budget-execution'?budgetMap[r.sourceRow]||null:form.uaoNumber===15&&sheet.name==='показатели'?({7:'coverage excluding financial statements/procurement',8:'financial excluding financial statements/procurement',11:'count',12:'cases with financial violations'}[r.sourceRow]||null):null,provenance:form.id==='uao-social'?provenance(socialMap[r.sourceRow]):form.id==='uao-budget-execution'&&budgetMap[r.sourceRow]?'demo-fixture':form.uaoNumber===15&&sheet.name==='показатели'&&[7,8,11,12].includes(r.sourceRow)?([11,12].includes(r.sourceRow)?'existing-demo-record':'demo-fixture'):'unavailable'}))};
 })}));
}
