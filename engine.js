import {joinAuditFacts,linkedFieldIds} from './linked-data.js';
import {fields,fieldMap,modules,defaultFilters} from './data.js';
export const linkedSources=['ВГА','СУР','Возражения'];
const registryFields=['id','module','date','region','organ','organCode','object','bin','status','auditor','count','objectCount','month'];
export const datasetKind=c=>c.dataset||(c.sources?.length===1?'module':'registry');
export function availableGroups(config){return ['none','region','organ','month',...(datasetKind(config)==='case-links'?[]:['module'])];}
export function availableFilters(config){
 const kind=datasetKind(config),keys=['from','to','region','organ','query'];
 if(kind==='registry')return [...keys,'status'];
 if(kind==='case-links')return [...keys,'risk','minFinancial'];
 const source=config.sources?.[0];keys.push('status');
 if(['ВГА','СВА'].includes(source))keys.push('format','kind','included');
 if(['ВГА','СВА','ПРОФ'].includes(source))keys.push('minFinancial');
 if(source==='СУР')keys.push('risk');
 if(source==='Возражения')keys.push('decision');
 if(['ВГА','СВА','ПРОФ','Возражения'].includes(source))keys.push('onlyOverdue');
 return keys;
}
// Used only when editing/migrating settings. Generation rejects invalid input.
export function normalizeBuilderConfig(input){
 const c=structuredClone(input);c.sources=[...new Set((c.sources||[]).filter(s=>modules.includes(s)))];
 c.dataset=datasetKind(c);if(!['module','registry','case-links'].includes(c.dataset))c.dataset='module';
 if(c.dataset==='case-links')c.sources=[...linkedSources];
 else if(c.dataset==='module')c.sources=[c.sources[0]||'ВГА'];
 if(!availableGroups(c).includes(c.group))c.group='none';
 const allowed=availableFields(c.sources,c.group,c.dataset).map(f=>f.id);
 c.columns=[...new Set((c.columns||[]).filter(k=>allowed.includes(k)))];
 if(c.group!=='none'&&allowed.includes(c.group)&&!c.columns.includes(c.group))c.columns.unshift(c.group);
 if(!c.columns.length)c.columns=['id','module','object'].filter(k=>allowed.includes(k));
 const old=c.filters||{};c.filters=defaultFilters();
 for(const key of availableFilters(c))if(old[key]!==undefined)c.filters[key]=old[key];
 c.template=null;c.reportId=null;return c;
}
export function validate(config){
 const f=config.filters||{};
 if(!Array.isArray(config.sources)||!config.sources.length) return 'Выберите хотя бы один модуль.';
 if(config.sources.some(s=>!modules.includes(s))||new Set(config.sources).size!==config.sources.length)return 'Проверьте список модулей.';
 const kind=datasetKind(config);
 if(!['module','registry','case-links'].includes(kind))return 'Выберите доступный набор данных.';
 if(kind==='module'&&config.sources.length!==1)return 'Для отчета по модулю выберите ровно один модуль.';
 if(kind==='case-links'&&(config.sources.length!==linkedSources.length||linkedSources.some(s=>!config.sources.includes(s))))return 'Связанный набор использует только ВГА, СУР и Возражения.';
 if(!availableGroups(config).includes(config.group))return 'Эта группировка недоступна для выбранного набора.';
 if(config.template&&(kind!=='module'||config.sources[0]!=='ВГА'||!['org','vga','ega','abp'].includes(config.template)||config.group!==(config.template==='org'?'organ':'none')))return 'Исходная форма недоступна для выбранного набора и группировки.';
 if(!/^\d{4}-\d{2}-\d{2}$/.test(f.from)||!/^\d{4}-\d{2}-\d{2}$/.test(f.to))return 'Укажите начало и конец периода.';
 for(const value of [f.from,f.to]) {const d=new Date(value);if(Number.isNaN(+d)||d.toISOString().slice(0,10)!==value)return 'Проверьте даты периода.';}
 if(f.from>f.to) return 'Начало периода не может быть позже окончания.';
 if(!Array.isArray(config.columns)||!config.columns.length)return 'Выберите хотя бы одно поле отчета.';
 if(config.group!=='none'&&!config.columns.includes(config.group))return 'Добавьте обязательное поле группировки в состав отчета.';
 const allowed=availableFields(config.sources,config.group,kind).map(f=>f.id);
 if(config.columns.some(k=>!allowed.includes(k)))return 'В отчете есть поля, недоступные для выбранного набора и группировки. Проверьте состав полей.';
 if(new Set(config.columns).size!==config.columns.length)return 'Поля отчета не должны повторяться.';
 const filterKeys=availableFilters(config);
 if(Object.entries(f).some(([k,v])=>!filterKeys.includes(k)&&v!==''&&v!==false&&v!=null))return 'В отчете есть фильтры, недоступные для выбранного набора. Проверьте параметры.';
 if(f.minFinancial!==''&&(!Number.isFinite(Number(f.minFinancial))||Number(f.minFinancial)<0))return 'Сумма нарушений должна быть неотрицательным числом.';
 return '';
}
export function filterRecords(records,config){
 const f=config.filters;
 return records.filter(r=>config.sources.includes(r.module)&&r.date>=f.from&&r.date<=f.to&&
  (!f.region||r.region===f.region)&&(!f.organ||r.organ===f.organ)&&(!f.status||r.status===f.status)&&
  (!f.format||r.format===f.format)&&(!f.kind||r.kind===f.kind)&&(!f.risk||r.risk===f.risk)&&(!f.decision||r.decision===f.decision)&&(!f.included||r.reportIncluded===f.included)&&
  (f.minFinancial===''||(r.financial!==null&&r.financial>=Number(f.minFinancial)))&&
  (!f.onlyOverdue||(r.deadline&&r.deadline<f.to&&!['Завершено','Рассмотрено'].includes(r.status)))&&
  (!f.query||[r.id,r.object,r.bin,r.auditor].some(v=>String(v??'').toLocaleLowerCase('ru').includes(f.query.toLocaleLowerCase('ru')))));
}
export function aggregate(rows,group){
 const unique=[...new Map(rows.map(r=>[`${r.module}:${r.id}`,r])).values()];
 if(group==='none')return unique;
 const groups=new Map();
 for(const r of unique){const key=r[group]??'Не применимо';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
 return [...groups.entries()].map(([key,items])=>{
  const out={[group]:key,_ids:items.map(r=>r.module+':'+r.id),count:items.length,objectCount:new Set(items.map(r=>r.bin).filter(Boolean)).size};
  if(group==='organ')out.organCode=items[0].organCode;
  for(const f of fields.filter(f=>['sum','avg'].includes(f.aggregation))){const ns=items.map(r=>r[f.id]).filter(v=>typeof v==='number');out[f.id]=ns.length?(f.aggregation==='avg'?ns.reduce((a,b)=>a+b,0)/ns.length:ns.reduce((a,b)=>a+b,0)):null;}
  return out;
 });
}
export function availableFields(sources,group,dataset){
 const kind=datasetKind({sources,dataset});
 if(!sources?.length||!['module','registry','case-links'].includes(kind))return [];
 return fields.filter(f=>(kind==='case-links'?linkedFieldIds.includes(f.id):kind==='registry'?registryFields.includes(f.id):!f.dataset&&sources.length===1&&f.available.includes(sources[0]))&&(group==='none'?!['count','objectCount','month'].includes(f.id):f.id===group||f.aggregation));
}
export function resultColumns(config){return config.group==='none'?[...config.columns]:[config.group,...config.columns.filter(k=>k!==config.group&&fieldMap[k]?.aggregation)];}
export function generate(records,config){const error=validate(config);if(error)throw new Error(error);const filtered=filterRecords(config.dataset==='case-links'?joinAuditFacts(undefined,config.filters.to):records,config);return {rows:structuredClone(aggregate(filtered,config.group)),columns:resultColumns(config),recordCount:new Set(filtered.map(r=>r.module+':'+r.id)).size,objectCount:new Set(filtered.map(r=>r.bin)).size,config:structuredClone(config),createdAt:new Date().toISOString()};}
export function sorted(rows,key,direction=1){return [...rows].sort((a,b)=>{const av=a[key],bv=b[key];if(av==null)return bv==null?0:1;if(bv==null)return -1;return direction*(typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv),'ru',{numeric:true}));});}
export function numericTotals(rows){const out={};for(const f of fields.filter(f=>f.aggregation==='sum')){const nums=rows.map(r=>r[f.id]).filter(v=>typeof v==='number');out[f.id]=nums.length?nums.reduce((a,b)=>a+b,0):null;}return out;}
export function formatValue(value,key){if(value==null||value==='')return '—';const f=fieldMap[key];if(f?.type==='date')return value.slice(0,10).split('-').reverse().join('.');if(typeof value==='number')return new Intl.NumberFormat('ru-RU',{maximumFractionDigits:f?.type==='integer'?0:2}).format(value);return String(value);}
export function templateMapping(id){
 if(id==='org')return {A:'_index',B:'_organCode',C:'organ',D:'count',E:'coverage',I:'financial',O:'procedural',P:'procedureCount',GI:'due',GN:'restored',GT:'orders',GU:'executed'};
 if(id==='abp')return {B:'id',C:'_organCode',D:'_month',E:'reportIncluded',F:'auditor',I:'date',K:'object',L:'bin',O:'abp',Q:'program',W:'coverage',AA:'financial',AG:'procedural',AH:'procedureCount',CA:'due',CF:'restored',CL:'orders',CM:'executed',CN:'deadline'};
 if(id==='vga')return {B:'_index',C:'id',D:'_organCode',E:'_month',F:'reportIncluded',G:'auditor',J:'date',M:'object',N:'bin',O:'abp',R:'coverage',V:'financial',AB:'procedural',AC:'procedureCount',GV:'due',HA:'restored',HH:'orders',HI:'executed'};
 return {B:'_index',C:'id',D:'_organCode',E:'_month',F:'reportIncluded',G:'auditor',J:'date',M:'object',N:'bin',O:'abp',R:'coverage',V:'financial',AB:'procedural',AC:'procedureCount',GV:'due',HA:'restored',HG:'orders',HH:'executed',HI:'deadline'};
}
export function templateValue(row,key,index){if(key==='_index')return index+1;if(key==='_organCode')return row.organCode??null; if(key==='_month')return row.date?Number(row.date.slice(5,7)):null;if(key==='reportIncluded')return row.reportIncluded==='Да'?1:row.reportIncluded==='Нет'?0:null;return row[key]??null;}
