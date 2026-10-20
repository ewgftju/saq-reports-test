import {fieldMap} from './data.js';
import {templateMapping,templateValue,formatValue} from './engine.js';
import {templates} from './templates.js';
const encoder=new TextEncoder();
const xml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');
export const colName=n=>{let out='';for(;n;n=Math.floor((n-1)/26))out=String.fromCharCode(65+(n-1)%26)+out;return out;};
function cell(ref,value,style=0){if(value==null)return `<c r="${ref}" s="${style}"/>`;if(typeof value==='number'&&Number.isFinite(value))return `<c r="${ref}" s="${style===0?(Number.isInteger(value)?3:2):style}"><v>${value}</v></c>`;return `<c r="${ref}" t="inlineStr" s="${style===0?4:style}"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;}
const row=(n,values,style=0,height)=>`<row r="${n}"${height?` ht="${height}" customHeight="1"`:''}>${values.map((v,i)=>cell(colName(i+1)+n,v,style)).join('')}</row>`;
const pre='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
function sheet(rows,{merges=[],widths=[],filter='',lastCol=1,lastRow=1}={}){return `${pre}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${colName(lastCol)}${lastRow}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="25"/><cols>${widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${rows}</sheetData>${filter?`<autoFilter ref="${filter}"/>`:''}${merges.length?`<mergeCells count="${merges.length}">${merges.map(ref=>`<mergeCell ref="${ref}"/>`).join('')}</mergeCells>`:''}<printOptions horizontalCentered="0"/><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;}
const styleXml=`${pre}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><color rgb="FF000000"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FF000000"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7E6E6"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FFB7B7B7"/></left><right style="thin"><color rgb="FFB7B7B7"/></right><top style="thin"><color rgb="FFB7B7B7"/></top><bottom style="thin"><color rgb="FFB7B7B7"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"><alignment vertical="top"/></xf><xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"><alignment vertical="top"/></xf><xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
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
function csvRows(rows){const safe=v=>{if(v==null)return '';const s=String(v);return typeof v==='string'&&/^[\s]*[=+@\-]/.test(s)?`'${s}`:s;};const quote=v=>'"'+safe(v).replaceAll('"','""')+'"';return '\uFEFF'+rows.map(r=>r.map(quote).join(';')).join('\r\n');}
export function exportCsv(result){return csvRows([result.columns.map(k=>fieldMap[k]?.label||k),...result.rows.map(r=>result.columns.map(k=>compactValue(r,k,result.config)))]);}

// Export selection is a projection of an already generated result, never a new query.
// "available" describes a configured source mapping, not row-by-row completeness.
export function exportColumnOptions(result,scope){
 if(scope!=='form'&&scope!=='report')throw new Error('Выберите доступный состав выгрузки.');
 if(scope==='report')return result.columns.map(key=>({id:`field:${key}`,label:fieldMap[key]?.label||key,group:fieldMap[key]?.source||'Реквизиты',available:true}));
 const template=templates.find(t=>t.id===result.config.template);
 if(!template)throw new Error('Для этого отчета нет исходной формы.');
 const mapping=templateMapping(template.id),root=c=>c.labels.find(label=>!/^(?:в том числе|из них)$/i.test(label.trim()));
 const sections=new Set(template.columns.filter(c=>c.labels.length>1).map(root));
 return template.columns.filter(c=>c.labels.length).map(c=>({id:`form:${c.letter}`,label:c.labels.join(' / '),group:sections.has(root(c))?root(c):'Реквизиты',available:Boolean(mapping[c.letter])}));
}
function selectedExport(result,scope,ids){
 const options=exportColumnOptions(result,scope);
 if(!Array.isArray(ids)||!ids.length)throw new Error('Выберите хотя бы одну колонку для выгрузки.');
 if(new Set(ids).size!==ids.length)throw new Error('Колонки выгрузки не должны повторяться.');
 const allowed=new Set(options.map(option=>option.id));
 if(ids.some(id=>!allowed.has(id)))throw new Error('В составе выгрузки есть недоступная колонка.');
 const selected=new Set(ids),columns=options.filter(option=>selected.has(option.id));
 let widths,values;
 if(scope==='form'){
  const template=templates.find(t=>t.id===result.config.template),mapping=templateMapping(template.id);
  const originals=columns.map(option=>template.columns.find(c=>`form:${c.letter}`===option.id));
  widths=originals.map(c=>columnWidth(c,true));
  values=result.rows.map((record,index)=>originals.map(c=>fullValue(record,c,mapping,index)));
 }else{
  const keys=columns.map(option=>option.id.slice(6));
  widths=keys.map(key=>['object','organ'].includes(key)?42:28);
  values=result.rows.map(record=>keys.map(key=>compactValue(record,key,result.config)));
 }
 return {columns,widths,values};
}
export function exportSelectedXlsx(result,scope,ids){
 const {columns,widths,values}=selectedExport(result,scope,ids),{config}=result;
 const headings=columns.map(column=>column.label),lastCol=columns.length,lastRow=values.length+1;
 const body=sheet(tableRows([headings,...values],widths),{widths,filter:`A1:${colName(lastCol)}${lastRow}`,lastCol,lastRow});
 const params=[['Параметр','Значение'],['Отчет',config.name],['Источник','Вымышленные демонстрационные записи. API модулей не подключены.'],['Модули',config.sources.join(', ')],['Сформирован',new Date(result.createdAt).toLocaleString('ru-RU',{timeZone:'Asia/Almaty'})],['Строк в выгрузке',result.rows.length],['Группировка',config.group],['Вид выгрузки',scope==='form'?'Выбранные колонки исходной формы':'Выбранные колонки отчета'],['Единица сумм','тыс. тенге'],...Object.entries(config.filters).filter(([,value])=>value!==''&&value!==false&&value!=null).map(([key,value])=>[filterNames[key]||key,String(value)]),['Нет данных','Источник показателя не подключен либо значение отсутствует. Это не ноль.'],['Не применимо','Показатель не относится к модулю записи.'],['Нулевые значения','Ноль означает известное нулевое значение.'],...headings.map((label,index)=>[`Выбранная колонка ${index+1}`,label])];
 return pack([{name:'Отчет',xml:body},{name:'Параметры',xml:sheet(tableRows(params,[38,100]),{widths:[38,100],lastCol:2,lastRow:params.length})}]);
}
export function exportSelectedCsv(result,scope,ids){
 const {columns,values}=selectedExport(result,scope,ids);
 return csvRows([columns.map(column=>column.label),...values]);
}

// Archive forms are already generated snapshots. Exporting never joins, sums or
// re-filters their rows, and a selection never hides a second complete copy.
function archiveSheets(result){
 if(!Array.isArray(result?.sheets)||!result.sheets.length)throw new Error('В отчете нет листов для выгрузки.');
 const sheetIds=new Set(),optionIds=new Set();
 for(const s of result.sheets){
  if(typeof s.id!=='string'||!s.id||sheetIds.has(s.id))throw new Error('Листы отчета должны иметь разные идентификаторы.');
  sheetIds.add(s.id);
  if(!Array.isArray(s.columns)||!s.columns.length||s.columns.length>16384)throw new Error('Неверный состав колонок листа отчета.');
  const columnIds=new Set();
  for(const c of s.columns){
   const id=`${s.id}:${c.id}`;
   if(typeof c.id!=='string'||!c.id||columnIds.has(c.id)||optionIds.has(id))throw new Error('Колонки листа должны иметь разные идентификаторы.');
   columnIds.add(c.id);optionIds.add(id);
  }
  if(!Array.isArray(s.rows))throw new Error('В отчете отсутствуют строки листа.');
  for(const values of s.rows){
   if(!Array.isArray(values)||values.length!==s.columns.length)throw new Error('Количество значений строки не соответствует колонкам листа.');
   values.forEach(archiveValue);
  }
 }
 return result.sheets;
}
function archiveValue(value){
 if(value==null||typeof value==='string'||typeof value==='boolean')return;
 if(typeof value==='number'&&Number.isFinite(value))return;
 throw new Error('В отчете есть неподдерживаемое или нечисловое значение.');
}
const archiveLabel=column=>column.label||column.labels?.filter(Boolean).join(' / ')||`Служебная колонка ${column.id}`;
function archiveOptions(sheets){
 return sheets.flatMap(s=>s.columns.map(c=>({id:`${s.id}:${c.id}`,label:archiveLabel(c),group:s.name||s.id,available:c.available!==false,sheetId:s.id,columnId:c.id})));
}
export function archiveColumnOptions(result){return archiveOptions(archiveSheets(result));}
function archiveSelection(result,selectedIds){
 const sheets=archiveSheets(result),options=archiveOptions(sheets);
 if(selectedIds==null)return sheets.map(s=>({source:s,indices:s.columns.map((_,i)=>i)}));
 if(!Array.isArray(selectedIds)||!selectedIds.length)throw new Error('Выберите хотя бы одну колонку для выгрузки.');
 if(new Set(selectedIds).size!==selectedIds.length)throw new Error('Колонки выгрузки не должны повторяться.');
 const allowed=new Set(options.map(c=>c.id));
 if(selectedIds.some(id=>!allowed.has(id)))throw new Error('В составе выгрузки есть недоступная колонка.');
 const chosen=new Set(selectedIds);
 return sheets.map(s=>({source:s,indices:s.columns.flatMap((c,i)=>chosen.has(`${s.id}:${c.id}`)?[i]:[])})).filter(s=>s.indices.length);
}
function archiveWidths(s,indices,flat){
 return indices.map(i=>{
  const provided=s.widths?.[i];
  if(typeof provided==='number'&&Number.isFinite(provided)&&provided>0)return Math.max(4,Math.min(80,provided));
  const c=s.columns[i],labels=c.labels?.length?c.labels:[archiveLabel(c)];
  return columnWidth({labels},flat);
 });
}
function archiveHeader(s,widths){
 const cells=s.headerCells||{},refs=Object.keys(cells);
 if(!refs.length){const values=s.columns.map(archiveLabel);return {depth:1,rows:[row(1,values,1,heightFor(values,widths,38))]};}
 const points=refs.map(ref=>{
  if(!/^[A-Z]+[1-9]\d*$/.test(ref))throw new Error('Неверная координата заголовка отчета.');
  const point=coordinates(ref);archiveValue(cells[ref]);
  if(point.col>s.columns.length)throw new Error('Заголовок выходит за границы колонок отчета.');
  return point;
 });
 const depth=s.headerDepth??Math.max(...points.map(p=>p.row));
 if(!Number.isInteger(depth)||depth<1||depth>1048576||points.some(p=>p.row>depth))throw new Error('Неверная глубина заголовка отчета.');
 const heights=Array(depth).fill(24),ranges=(s.merges||[]).map(archiveMerge).filter(m=>m.end.row<=depth);
 const constraints=refs.map((ref,i)=>{
  const start=points[i],end=ranges.find(m=>m.start.row===start.row&&m.start.col===start.col)?.end||start;
  const width=widths.slice(start.col-1,end.col).reduce((sum,v)=>sum+v,0);
  return {start:start.row-1,end:end.row-1,height:Math.max(24,lineCount(cells[ref],width)*14+10)};
 }).sort((a,b)=>(a.end-a.start)-(b.end-b.start));
 for(const c of constraints){const current=heights.slice(c.start,c.end+1).reduce((a,b)=>a+b,0);if(c.height>current){const extra=Math.ceil((c.height-current)/(c.end-c.start+1));for(let i=c.start;i<=c.end;i++)heights[i]=Math.min(409,heights[i]+extra);}}
 const values=Array.from({length:depth},()=>Array(s.columns.length).fill(null));
 refs.forEach((ref,i)=>values[points[i].row-1][points[i].col-1]=cells[ref]);
 return {depth,rows:values.map((v,i)=>row(i+1,v,1,heights[i]))};
}
function archiveMerge(ref){
 if(typeof ref!=='string'||!/^([A-Z]+[1-9]\d*):([A-Z]+[1-9]\d*)$/.test(ref))throw new Error('Неверное объединение ячеек отчета.');
 const [start,end]=ref.split(':').map(coordinates);
 if(start.row>end.row||start.col>end.col)throw new Error('Неверные границы объединения ячеек отчета.');
 return {ref,start,end};
}
function archiveSheetXml(s,indices,flat){
 const widths=archiveWidths(s,indices,flat),values=s.rows.map(values=>indices.map(i=>values[i]));
 let rows,depth,merges=[],filter='';
 if(flat||!Object.keys(s.headerCells||{}).length){
  depth=1;rows=tableRows([indices.map(i=>archiveLabel(s.columns[i])),...values],widths);filter=`A1:${colName(indices.length)}${values.length+1}`;
 }else{
  const layout=archiveHeader(s,widths);depth=layout.depth;
  merges=(s.merges||[]).map(archiveMerge).map(m=>{
   if(m.end.col>indices.length||m.end.row>values.length+depth)throw new Error('Объединение ячеек выходит за границы отчета.');
   return m.ref;
  });
  rows=layout.rows.join('')+values.map((v,i)=>row(i+depth+1,v,0,heightFor(v,widths))).join('');
 }
 if(values.length+depth>1048576)throw new Error('Количество строк превышает ограничение Excel.');
 return sheet(rows,{merges,widths,filter,lastCol:indices.length,lastRow:values.length+depth});
}
function archiveSheetName(value,index,used){
 const clean=String(value||`Лист ${index+1}`).replace(/[\\/\?*\[\]:\u0000-\u001f]/g,' ').trim().replace(/^'+|'+$/g,'').trim()||`Лист ${index+1}`;
 const trim=(s,n)=>{const value=s.slice(0,n);return /[\uD800-\uDBFF]$/.test(value)?value.slice(0,-1):value;};
 let name=trim(clean,31),suffix=1;
 while(used.has(name.toLocaleLowerCase('ru'))){const ending=` (${++suffix})`;name=trim(clean,31-ending.length)+ending;}
 used.add(name.toLocaleLowerCase('ru'));return name;
}
export function exportArchiveXlsx(result,selectedIds=null){
 const selection=archiveSelection(result,selectedIds),used=new Set(),flat=selectedIds!=null;
 const sheets=selection.map(({source,indices},i)=>({name:archiveSheetName(source.name,i,used),xml:archiveSheetXml(source,indices,flat)}));
 const config=result.config||{},date=new Date(result.createdAt),params=[['Параметр','Значение'],['Отчет',config.name||'Отчет'],['Источник','Вымышленные демонстрационные записи. API модулей не подключены.'],['Модули',(config.sources||[]).join(', ')],['Вид выгрузки',flat?'Выбранные колонки':'Все листы и колонки формы'],['Сформирован',Number.isNaN(date.getTime())?'':date.toLocaleString('ru-RU',{timeZone:'Asia/Almaty'})],['Записей',result.recordCount??''],['Объектов',result.objectCount??''],...Object.entries(config.filters||{}).filter(([,v])=>v!==''&&v!==false&&v!=null).map(([key,value])=>[filterNames[key]||key,String(value)]),['Нет данных','Источник показателя не подключен либо значение отсутствует. Это не ноль.'],['Нулевые значения','Ноль означает известное нулевое значение.']];
 selection.forEach(({source,indices},i)=>{
  params.push([`Лист ${i+1}`,sheets[i].name],[`Строк на листе ${i+1}`,source.rows.length]);
  if(flat)indices.forEach((columnIndex,j)=>params.push([`Колонка ${i+1}.${j+1}`,archiveLabel(source.columns[columnIndex])]));
 });
 sheets.push({name:archiveSheetName('Параметры',sheets.length,used),xml:sheet(tableRows(params,[38,100]),{widths:[38,100],lastCol:2,lastRow:params.length})});
 return pack(sheets);
}
export function exportArchiveCsv(result,selectedIds=null){
 const selection=archiveSelection(result,selectedIds);
 if(selection.length!==1)throw new Error('CSV содержит только один лист. Выберите колонки одного листа или скачайте Excel со всеми листами.');
 const {source,indices}=selection[0];
 return csvRows([indices.map(i=>archiveLabel(source.columns[i])),...source.rows.map(values=>indices.map(i=>values[i]))]);
}
export function download(data,name,type){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
