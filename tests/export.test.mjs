import test from 'node:test';
import assert from 'node:assert/strict';
import {records,reports,defaultFilters,modules,fieldMap} from '../data.js';
import {generate,templateMapping} from '../engine.js';
import {templates} from '../templates.js';
import {exportXlsx,exportCsv,colName} from '../export.js';

// Read actual local ZIP entries, not a string search across the archive directory.
function unzip(bytes){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),decode=new TextDecoder(),files={};let offset=0;
 while(offset+30<=bytes.length&&view.getUint32(offset,true)===0x04034b50){
  assert.equal(view.getUint16(offset+8,true),0,'stored ZIP entry');
  const size=view.getUint32(offset+18,true),nameLength=view.getUint16(offset+26,true),extraLength=view.getUint16(offset+28,true);
  const name=decode.decode(bytes.slice(offset+30,offset+30+nameLength)),start=offset+30+nameLength+extraLength;
  files[name]=decode.decode(bytes.slice(start,start+size));offset=start+size;
 }
 assert.ok(files['xl/workbook.xml']);return files;
}
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const cellXml=(sheet,ref)=>sheet.match(new RegExp(`<c r="${ref}"(?:[^>]*\\/>|[^>]*>[\\s\\S]*?<\\/c>)`))?.[0];
const resultFor=id=>{const report=reports.find(r=>r.id===id);return generate(records,{name:report.name,sources:report.source,columns:report.columns,group:report.group,template:report.template,filters:{...defaultFilters(),format:report.format||''}});};
// Legacy snapshot fixture exercises serialization independently of builder validation.
const custom=()=>({config:{name:'Проверка реквизитов',sources:modules,columns:['id','module','financial','risk'],group:'none',filters:defaultFilters()},columns:['id','module','financial','risk'],rows:[],createdAt:new Date().toISOString()});

test('every XLSX view starts with its table and no sheet freezes rows or adds a report banner/footer',()=>{
 for(const mode of [false,true,'flat'])for(const template of templates){
  const result=resultFor(template.id),files=unzip(exportXlsx(result,mode)),report=files['xl/worksheets/sheet1.xml'];
  assert.match(report,/<sheetData><row r="1"/);
  assert.doesNotMatch(report,/ДЕМОНСТРАЦИОННЫЕ ДАННЫЕ|Не для официальной отчетности|2026-01-01|2026-09-30/);
  assert.ok(!report.includes(escape(result.config.name)),'title is on Parameters sheet only');
  for(const [name,content]of Object.entries(files).filter(([name])=>name.startsWith('xl/worksheets/'))){
   assert.doesNotMatch(content,/<pane\b|state="frozen"|headerFooter|oddFooter|printTitles/,name);
  }
  assert.match(files['xl/worksheets/sheet2.xml'],/Вымышленные демонстрационные записи/);
  assert.match(files['xl/styles.xml'],/fgColor rgb="FFE7E6E6"/);
  assert.doesNotMatch(files['xl/styles.xml'],/FF003B5C|FFEEF4F8/);
 }
});

test('all original headers and merges move up three rows and data begins immediately at row seven',()=>{
 for(const t of templates){
  const result=resultFor(t.id),report=unzip(exportXlsx(result,true))['xl/worksheets/sheet1.xml'];
  assert.match(report,new RegExp(`<dimension ref="A1:${colName(t.columnCount)}${result.rows.length+6}"`));
  for(const [ref,label]of Object.entries(t.headerCells)){
   const remapped=ref.replace(/\d+$/,n=>String(Number(n)-3));
   assert.ok(cellXml(report,remapped)?.includes(escape(label)),`${t.id} header ${ref} -> ${remapped}`);
  }
  const expected=t.merges.filter(ref=>Number(ref.match(/\d+/)[0])>=4).map(ref=>ref.replace(/\d+/g,n=>String(Number(n)-3))).sort();
  const actual=[...report.matchAll(/<mergeCell ref="([^"]+)"\/>/g)].map(m=>m[1]).sort();
  assert.deepEqual(actual,expected,t.id);
  const heights=[...report.matchAll(/<row r="(\d+)" ht="([\d.]+)"/g)].filter(m=>Number(m[1])<=6).map(m=>Number(m[2]));
  assert.equal(heights.length,6);assert.ok(heights.reduce((a,b)=>a+b,0)<450,'smaller than six fixed 75pt rows');
  assert.ok(cellXml(report,'B7'),'first data row directly follows header');
 }
});

test('full forms explicitly mark every unavailable indicator, keep zero and leave only service columns empty',()=>{
 for(const t of templates){
  const result=resultFor(t.id),mapping=templateMapping(t.id),report=unzip(exportXlsx(result,true))['xl/worksheets/sheet1.xml'];
  for(const column of t.columns){
   const cell=cellXml(report,`${column.letter}7`);assert.ok(cell);
   if(!column.labels.length)assert.match(cell,/\/>$/);
   else if(!mapping[column.letter])assert.match(cell,/>Нет данных</);
   else assert.doesNotMatch(cell,/\/>$/,'mapped missing value also needs an explicit marker');
  }
  if(t.id!=='org'){
   const financial=t.columns.find(c=>mapping[c.letter]==='financial');
   assert.match(cellXml(report,`${financial.letter}7`),/<v>0<\/v>/,'known zero must not turn into missing data');
  }
 }
});

test('flat full forms expose complete header paths, all columns and a single filterable unmerged row',()=>{
 for(const t of templates){
  const result=resultFor(t.id),report=unzip(exportXlsx(result,'flat'))['xl/worksheets/sheet1.xml'];
  assert.doesNotMatch(report,/mergeCell/);
  assert.match(report,new RegExp(`<autoFilter ref="A1:${colName(t.columnCount)}${result.rows.length+1}"`));
  for(const c of t.columns)assert.ok(cellXml(report,`${c.letter}1`)?.includes(escape(c.labels.length?c.labels.join(' / '):`Служебная колонка ${c.letter}`)),`${t.id} ${c.letter}`);
  assert.ok(cellXml(report,`${t.columns.find(c=>!templateMapping(t.id)[c.letter]&&c.labels.length).letter}2`).includes('Нет данных'));
 }
});

test('compact rows and grouped rows distinguish unknown values from source-inapplicable fields',()=>{
 const result=custom();
 result.rows=[{module:'СУР',id:'R1',financial:null,risk:null},{module:'ВГА',id:'V1',financial:null,risk:null},{module:'ВГА',id:'V2',financial:0,risk:null},{_ids:['СУР:R2'],financial:null,risk:null}];
 const report=unzip(exportXlsx(result))['xl/worksheets/sheet1.xml'];
 assert.match(cellXml(report,'C2'),/>Не применимо</);assert.match(cellXml(report,'D2'),/>Нет данных</);
 assert.match(cellXml(report,'C3'),/>Нет данных</);assert.match(cellXml(report,'D3'),/>Не применимо</);
 assert.match(cellXml(report,'C4'),/<v>0<\/v>/);assert.match(cellXml(report,'C5'),/>Не применимо</);
 assert.match(report,/<autoFilter ref="A1:D5"/);
});

test('CSV begins with field headers and keeps missing-value meaning and formula escaping',()=>{
 const result=custom();result.rows=[{id:'=2+2',module:'СУР',financial:null,risk:null}];
 const csv=exportCsv(result),lines=csv.slice(1).split('\r\n');
 assert.equal(lines.length,2);assert.equal(lines[0],result.columns.map(k=>`"${fieldMap[k].label}"`).join(';'));
 assert.match(lines[1],/"'=2\+2";"СУР";"Не применимо";"Нет данных"/);
 assert.doesNotMatch(csv,/ДЕМОНСТРАЦИОННЫЕ ДАННЫЕ|2026-01-01|2026-09-30/);
});
