import {fieldMap} from './data.js';
import {templateMapping,templateValue,formatValue} from './engine.js';
import {templates} from './templates.js';
const encoder=new TextEncoder();
const xml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');
export const colName=n=>{let out='';for(;n;n=Math.floor((n-1)/26))out=String.fromCharCode(65+(n-1)%26)+out;return out;};
function cell(ref,value,style=0){if(value==null)return `<c r="${ref}" s="${style}"/>`;if(typeof value==='number'&&Number.isFinite(value))return `<c r="${ref}" s="${style===0?(Number.isInteger(value)?3:2):style}"><v>${value}</v></c>`;return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;}
const row=(n,values,style=0,height)=>`<row r="${n}"${height?` ht="${height}" customHeight="1"`:''}>${values.map((v,i)=>cell(colName(i+1)+n,v,style)).join('')}</row>`;
const pre='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
function sheet(rows,{merges=[],widths=[],filter='',lastCol=1,lastRow=1}={}){return `${pre}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${colName(lastCol)}${lastRow}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="25"/><cols>${widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${rows}</sheetData>${filter?`<autoFilter ref="${filter}"/>`:''}${merges.length?`<mergeCells count="${merges.length}">${merges.map(ref=>`<mergeCell ref="${ref}"/>`).join('')}</mergeCells>`:''}<printOptions horizontalCentered="0"/><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;}
const styleXml=`${pre}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><color rgb="FF000000"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FF000000"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7E6E6"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FFB7B7B7"/></left><right style="thin"><color rgb="FFB7B7B7"/></right><top style="thin"><color rgb="FFB7B7B7"/></top><bottom style="thin"><color rgb="FFB7B7B7"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"><alignment vertical="top"/></xf><xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"><alignment vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
const coordinates=ref=>{const [,letters,digits]=ref.match(/^([A-Z]+)([0-9]+)$/);return {col:[...letters].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0),row:Number(digits)};};
const moveRef=(ref,offset)=>{const point=coordinates(ref);return `${colName(point.col)}${point.row-offset}`;};
function lineCount(value,width){
 const capacity=Math.max(5,Math.floor(width*.86));
 return String(value??'').split('\n').reduce((total,line)=>{
  let count=1,used=0;
  for(const word of line.split(/\s+/).filter(Boolean)){
   if(used&&used+1+word.length>capacity){count++;used=0;}
   const length=word.length+(used?1:0);used+=length;
   if(used>capacity){count+=Math.floor((used-1)/capacity);used=(used-1)%capacity+1;}
  }
  return total+count;
 },0);
}
const heightFor=(values,widths,min=25)=>Math.min(409,Math.max(min,...values.map((v,i)=>lineCount(v,widths[i]||25)*14+10)));
const tableRows=(values,widths)=>values.map((r,i)=>row(i+1,r,i===0?1:0,heightFor(r,widths,i===0?38:25))).join('');
function columnWidth(column,flat=false){
 const labels=column.labels||[],leaf=labels.at(-1)||'';
 if(!labels.length)return 4;
 if(flat)return Math.max(26,Math.min(60,Math.ceil(labels.join(' / ').length/5)));
 if(/^№\s*п\s*\/\s*п$/.test(leaf))return 8;
 if(/Наименование|наименование|Автор|Основание/.test(leaf))return 42;
 if(/БИН|[Дд]ата|[Сс]рок/.test(leaf))return 18;
 if(/Номер дела|Орган аудита/.test(leaf))return 28;
 return 24;
}
function headerLayout(template,widths){
 const refs=Object.keys(template.headerCells),first=Math.min(...refs.map(r=>coordinates(r).row)),last=Math.max(...refs.map(r=>coordinates(r).row));
 const offset=first-1,heights=Array(last-first+1).fill(24);
 const ranges=template.merges.map(ref=>{const [start,end]=ref.split(':').map(coordinates);return {ref,start,end};}).filter(m=>m.start.row>=first&&m.end.row<=last);
 const constraints=Object.entries(template.headerCells).map(([ref,value])=>{
  const start=coordinates(ref),merge=ranges.find(m=>m.start.row===start.row&&m.start.col===start.col),end=merge?.end||start;
  const width=widths.slice(start.col-1,end.col).reduce((sum,v)=>sum+v,0);
  return {start:start.row-first,end:end.row-first,height:Math.max(24,lineCount(value,width)*14+10)};
 }).sort((a,b)=>(a.end-a.start)-(b.end-b.start));
 for(const c of constraints){const height=heights.slice(c.start,c.end+1).reduce((a,b)=>a+b,0);if(c.height>height){const extra=Math.ceil((c.height-height)/(c.end-c.start+1));for(let i=c.start;i<=c.end;i++)heights[i]+=extra;}}
 const rows=heights.map((height,i)=>{
  const values=Array(template.columnCount).fill(null);
  for(const [ref,value]of Object.entries(template.headerCells)){const point=coordinates(ref);if(point.row===i+first)values[point.col-1]=value;}
  return row(i+1,values,1,height);
 });
 return {rows,depth:heights.length,merges:ranges.map(m=>m.ref.split(':').map(ref=>moveRef(ref,offset)).join(':'))};
}
// A missing fact and a fact inapplicable to this source must not look like zero.
function missingValue(record,key,config){
 if(config.dataset==='case-links')return 'Нет данных';
 const available=fieldMap[key]?.available;
 const sources=record.module?[record.module]:record._sources?.length?record._sources:record._ids?.length?[...new Set(record._ids.map(id=>id.split(':')[0]))]:config.sources;
 return available&&sources?.length&&!sources.some(source=>available.includes(source))?'Не применимо':'Нет данных';
}
function compactValue(record,key,config){const value=record[key];return value==null||value===''?missingValue(record,key,config):fieldMap[key]?.type==='date'?formatValue(value,key):value;}
function fullValue(record,column,mapping,index){
 if(!column.labels.length)return null;
 const key=mapping[column.letter];
 if(!key)return 'Нет данных';
 const value=templateValue(record,key,index);
 return value==null||value===''?'Нет данных':fieldMap[key]?.type==='date'?formatValue(value,key):value;
}
const crcTable=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc32=bytes=>{let crc=0xffffffff;for(const b of bytes)crc=crcTable[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;};
// Standard ZIP (stored entries) keeps exports offline and dependency-free.
export function zip(files){const chunks=[],central=[];let offset=0;const header=(len)=>{const a=new Uint8Array(len);return [a,new DataView(a.buffer)];};for(const [name,text]of Object.entries(files)){const nameBytes=encoder.encode(name),data=encoder.encode(text),crc=crc32(data);const [h,v]=header(30);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,nameBytes.length,true);chunks.push(h,nameBytes,data);const [c,cv]=header(46);cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(8,0x800,true);cv.setUint32(16,crc,true);cv.setUint32(20,data.length,true);cv.setUint32(24,data.length,true);cv.setUint16(28,nameBytes.length,true);cv.setUint32(42,offset,true);central.push(c,nameBytes);offset+=h.length+nameBytes.length+data.length;}const centralSize=central.reduce((a,c)=>a+c.length,0);const [end,ev]=header(22);ev.setUint32(0,0x06054b50,true);ev.setUint16(8,Object.keys(files).length,true);ev.setUint16(10,Object.keys(files).length,true);ev.setUint32(12,centralSize,true);ev.setUint32(16,offset,true);const all=[...chunks,...central,end];const bytes=new Uint8Array(all.reduce((a,c)=>a+c.length,0));let p=0;for(const c of all){bytes.set(c,p);p+=c.length;}return bytes;}
function pack(sheets){const files={'[Content_Types].xml':`${pre}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,'_rels/.rels':`${pre}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,'xl/workbook.xml':`${pre}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s,i)=>`<sheet name="${xml(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`,'xl/_rels/workbook.xml.rels':`${pre}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,'xl/styles.xml':styleXml};sheets.forEach((s,i)=>files[`xl/worksheets/sheet${i+1}.xml`]=s.xml);return zip(files);}
const filterNames={from:'Период с',to:'Период по',region:'Регион',organ:'Орган аудита',status:'Статус',query:'Поиск',format:'Формат',kind:'Тип аудита',risk:'Уровень риска',decision:'Решение',included:'Включен в отчетность',minFinancial:'Минимум финансовых нарушений, тыс. ₸',onlyOverdue:'Просроченные на конец периода'};
export function exportXlsx(result,original=false){
 const {config}=result,t=templates.find(t=>t.id===config.template),full=Boolean(original&&t),flat=original==='flat';let body;
 if(full){
  const mapping=templateMapping(t.id),widths=t.columns.map(c=>columnWidth(c,flat)),values=result.rows.map((r,i)=>t.columns.map(c=>fullValue(r,c,mapping,i)));
  if(flat){const headings=t.columns.map(c=>c.labels.length?c.labels.join(' / '):`Служебная колонка ${c.letter}`);body=sheet(tableRows([headings,...values],widths),{widths,filter:`A1:${colName(t.columnCount)}${values.length+1}`,lastCol:t.columnCount,lastRow:values.length+1});}
  else {const layout=headerLayout(t,widths);body=sheet(layout.rows.join('')+values.map((r,i)=>row(i+layout.depth+1,r,0,heightFor(r,widths))).join(''),{merges:layout.merges,widths,lastCol:t.columnCount,lastRow:values.length+layout.depth});}
 } else {
  const widths=result.columns.map(k=>['object','organ'].includes(k)?42:28),values=result.rows.map(r=>result.columns.map(k=>compactValue(r,k,config)));
  body=sheet(tableRows([result.columns.map(k=>fieldMap[k]?.label||k),...values],widths),{widths,filter:`A1:${colName(result.columns.length)}${values.length+1}`,lastCol:result.columns.length,lastRow:values.length+1});
 }
 const params=[['Параметр','Значение'],['Отчет',config.name],['Источник','Вымышленные демонстрационные записи. API модулей не подключены.'],['Модули',config.sources.join(', ')],['Сформирован',new Date(result.createdAt).toLocaleString('ru-RU',{timeZone:'Asia/Almaty'})],['Записей',result.recordCount],['Объектов',result.objectCount],['Группировка',config.group],['Вид выгрузки',full?(flat?'Все показатели — плоская таблица':'Все показатели — исходная шапка'):'Выбранные показатели'],['Единица сумм','тыс. тенге'],...Object.entries(config.filters).filter(([,v])=>v!==''&&v!==false).map(([k,v])=>[filterNames[k]||k,String(v)]),['Правило периода',config.dataset==='case-links'?'Дела по дате в периоде; связанные нарушения, подтверждённые исполнения и отмены накопительно на конец периода.':'По отчетной дате включительно; просрочка определяется на конец выбранного периода.'],['Нет данных','Показатель не подключен к источнику либо значение отсутствует. Это не ноль.'],['Не применимо','Показатель не относится к модулю записи; используется в выгрузке выбранных показателей.'],['Нулевые значения','Ноль означает известное нулевое значение. Пустыми остаются только служебные колонки исходной формы.'],['Связи',config.dataset==='case-links'?'Одна строка — дело ВГА. СУР — по assessmentId; возражения — по sourceModule и caseId; исполнения — по violationId. Суммы дочерних записей агрегируются до соединения.':'Возражения не добавляют финансовые суммы повторно. Количество объектов — уникальные БИН.']];
 const sheets=[{name:'Отчет',xml:body},{name:'Параметры',xml:sheet(tableRows(params,[38,100]),{widths:[38,100],lastCol:2,lastRow:params.length})}];
 if(full){const mapping=templateMapping(t.id),rows=[['Колонка','Показатель исходной формы','Источник значения']];t.columns.forEach(c=>rows.push([c.letter,c.labels.join(' / ')||'Служебная колонка',!c.labels.length?'Служебная колонка; не заполняется':mapping[c.letter]?'Поле демонстрационного набора; при отсутствии значения — «Нет данных»':'Нет данных; источник показателя не подключен']));sheets.push({name:'Состав формы',xml:sheet(tableRows(rows,[14,100,60]),{widths:[14,100,60],lastCol:3,lastRow:rows.length})});}
 return pack(sheets);
}
export function exportCsv(result){const safe=v=>{if(v==null)return '';const s=String(v);return typeof v==='string'&&/^[\s]*[=+@\-]/.test(s)?`'${s}`:s;};const quote=v=>'"'+safe(v).replaceAll('"','""')+'"';return '\uFEFF'+[result.columns.map(k=>fieldMap[k]?.label||k),...result.rows.map(r=>result.columns.map(k=>compactValue(r,k,result.config)))].map(r=>r.map(quote).join(';')).join('\r\n');}
export function download(data,name,type){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
