import {joinAuditFacts,linkedFieldIds} from './linked-data.js';
import {fields,fieldMap} from './data.js';
export function validate(config){
 const f=config.filters;
 if(!config.sources?.length) return 'Выберите хотя бы один модуль.';
 if(!/^\d{4}-\d{2}-\d{2}$/.test(f.from)||!/^\d{4}-\d{2}-\d{2}$/.test(f.to))return 'Укажите начало и конец периода.';
 for(const value of [f.from,f.to]) {const d=new Date(value);if(Number.isNaN(+d)||d.toISOString().slice(0,10)!==value)return 'Проверьте даты периода.';}
 if(f.from>f.to) return 'Начало периода не может быть позже окончания.';
 if(!config.columns?.length)return 'Выберите хотя бы одно поле отчета.';
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
export function availableFields(sources,group,dataset){return fields.filter(f=>(dataset==='case-links'?linkedFieldIds.includes(f.id):!f.dataset)&&f.available.some(m=>sources.includes(m))&&(group==='none'?!['count','objectCount','month'].includes(f.id):f.id===group||f.aggregation));}
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
