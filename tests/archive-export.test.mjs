import test from 'node:test';
import assert from 'node:assert/strict';
import {archiveColumnOptions,exportArchiveXlsx,exportArchiveCsv} from '../export.js';

function unzip(bytes){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),decode=new TextDecoder(),files={};let offset=0;
 while(offset+30<=bytes.length&&view.getUint32(offset,true)===0x04034b50){
  assert.equal(view.getUint16(offset+8,true),0);
  const size=view.getUint32(offset+18,true),nameLength=view.getUint16(offset+26,true),extraLength=view.getUint16(offset+28,true),start=offset+30+nameLength+extraLength;
  files[decode.decode(bytes.slice(offset+30,offset+30+nameLength))]=decode.decode(bytes.slice(start,start+size));offset=start+size;
 }
 return files;
}
const decode=value=>value.replace(/&(amp|lt|gt|quot|apos);/g,(_,name)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[name]));
function cells(xml){
 return Object.fromEntries([...xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map(([,ref,attributes,body=''])=>[ref,attributes.includes('inlineStr')?decode(body.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1]||''):body.includes('<v>')?Number(body.match(/<v>(.*?)<\/v>/)[1]):null]));
}
function fixture(){return {
 config:{name:'Отчет УАО',sources:['ВГА'],filters:{from:'2026-01-01',to:'2026-09-30',region:'г. Астана',query:'',onlyOverdue:false}},createdAt:'2026-10-20T00:00:00Z',recordCount:2,objectCount:2,
 sheets:[
  {id:'main',name:'Результаты',columns:[{id:'A',label:'Номер'},{id:'B',labels:['Результаты','Сумма'],available:true},{id:'C',label:'БИН'},{id:'D',label:'Примечание',available:false}],headerDepth:2,headerCells:{A1:'Номер',B1:'Результаты',B2:'Сумма',C2:'БИН',D1:'Примечание'},merges:['A1:A2','B1:C1','D1:D2'],rows:[['CASE-1',0,'990000000001',null],['CASE-2',123.45,'990000000002','Нет данных']]},
  {id:'matrix',name:'Показатели',columns:[{id:'A',label:'Показатель'},{id:'B',label:'Текущий период'},{id:'C',label:'Прошлый период'}],headerDepth:3,headerCells:{A1:'Показатель',B1:'Период',B2:'Текущий',C2:'Прошлый'},merges:['A1:A3','B1:C1'],rows:[['Объем <аудита> & результат',123.45,'Нет данных'],['Количество',2,0]]}
 ]
};}

test('archive full Excel preserves every sheet, multilevel headers, trailing header rows and numeric/text types',()=>{
 const result=fixture(),before=structuredClone(result),files=unzip(exportArchiveXlsx(result));
 assert.deepEqual(result,before);
 assert.equal(Object.keys(files).filter(name=>/^xl\/worksheets\//.test(name)).length,3);
 assert.match(files['xl/workbook.xml'],/name="Результаты"/);assert.match(files['xl/workbook.xml'],/name="Показатели"/);
 const first=files['xl/worksheets/sheet1.xml'],second=files['xl/worksheets/sheet2.xml'];
 assert.match(first,/<dimension ref="A1:D4"/);assert.match(first,/<mergeCell ref="B1:C1"/);
 assert.match(second,/<dimension ref="A1:C5"/);assert.match(second,/<mergeCell ref="A1:A3"/);
 assert.deepEqual(cells(first),{A1:'Номер',B1:'Результаты',C1:null,D1:'Примечание',A2:null,B2:'Сумма',C2:'БИН',D2:null,A3:'CASE-1',B3:0,C3:'990000000001',D3:null,A4:'CASE-2',B4:123.45,C4:'990000000002',D4:'Нет данных'});
 assert.equal(cells(second).A4,'Объем <аудита> & результат');assert.equal(cells(second).C5,0);
 assert.match(first,/<c r="B3" s="3"><v>0<\/v>/);assert.match(first,/<c r="B4" s="2"><v>123.45<\/v>/);
 assert.match(first,/<c r="C3" t="inlineStr" s="4">/);
 assert.match(files['xl/styles.xml'],/numFmtId="49"/);assert.match(files['xl/styles.xml'],/FFE7E6E6/);
 for(const content of Object.values(files))assert.doesNotMatch(content,/<pane\b|state="frozen"|state="hidden"/);
 for(const body of [first,second])assert.doesNotMatch(body,/ДЕМОНСТРАЦИОННЫЕ ДАННЫЕ|Отчет УАО|Не для официальной отчетности/);
 assert.match(files['xl/worksheets/sheet3.xml'],/г. Астана/);assert.match(files['xl/worksheets/sheet3.xml'],/2026-09-30/);
});

test('archive options and selected export retain canonical order and omit every unselected column and sheet',()=>{
 const result=fixture();result.sheets[0].rows[0][0]='PRIVATE_UNSELECTED';
 const options=archiveColumnOptions(result);
 assert.deepEqual(options.map(c=>c.id),['main:A','main:B','main:C','main:D','matrix:A','matrix:B','matrix:C']);
 assert.equal(options[1].label,'Результаты / Сумма');assert.equal(options[3].available,false);assert.equal(options[4].group,'Показатели');
 const files=unzip(exportArchiveXlsx(result,['matrix:C','matrix:A']));
 assert.equal(Object.keys(files).filter(name=>/^xl\/worksheets\//.test(name)).length,2);
 assert.doesNotMatch(files['xl/workbook.xml'],/name="Результаты"/);
 assert.ok(Object.values(files).every(value=>!value.includes('PRIVATE_UNSELECTED')&&!value.includes('123.45')&&!value.includes('Текущий период')));
 const body=files['xl/worksheets/sheet1.xml'];
 assert.deepEqual(cells(body),{A1:'Показатель',B1:'Прошлый период',A2:'Объем <аудита> & результат',B2:'Нет данных',A3:'Количество',B3:0});
 assert.match(body,/<autoFilter ref="A1:B3"/);assert.doesNotMatch(body,/<mergeCells/);
 const twoSheets=unzip(exportArchiveXlsx(result,['matrix:B','main:B']));
 assert.equal(cells(twoSheets['xl/worksheets/sheet1.xml']).A1,'Результаты / Сумма');assert.equal(cells(twoSheets['xl/worksheets/sheet2.xml']).A1,'Текущий период');
});

test('archive sheet names are valid and unique, including a source sheet named Параметры',()=>{
 const result=fixture();const name="'Неправильный/лист?очень:длинный[вопрос]*\\'";
 result.sheets[0].name=name;result.sheets[1].name=name.toUpperCase();result.sheets.push({...structuredClone(result.sheets[0]),id:'params',name:'Параметры'});
 const files=unzip(exportArchiveXlsx(result)),names=[...files['xl/workbook.xml'].matchAll(/<sheet name="([^"]+)"/g)].map(m=>decode(m[1]));
 assert.equal(names.length,4);assert.equal(new Set(names.map(name=>name.toLocaleLowerCase('ru'))).size,4);
 for(const name of names){assert.ok(name.length<=31);assert.doesNotMatch(name,/[\\/\?*\[\]:\u0000-\u001f]/);assert.doesNotMatch(name,/^'|'$/);}
 assert.equal(names[2],'Параметры');assert.equal(names[3],'Параметры (2)');
});

test('archive CSV explicitly requires one sheet, escapes formula text, and keeps all selected rows',()=>{
 const result=fixture();result.sheets[0].rows[0][0]='=HYPERLINK("x")';
 assert.throws(()=>exportArchiveCsv(result),/CSV содержит только один лист/);
 assert.throws(()=>exportArchiveCsv(result,['main:A','matrix:A']),/CSV содержит только один лист/);
 const csv=exportArchiveCsv(result,['main:B','main:A']);
 assert.ok(csv.startsWith('\uFEFF"Номер";"Результаты / Сумма"'));
 assert.ok(csv.includes('"\'=HYPERLINK(""x"")";"0"'));assert.ok(csv.includes('"CASE-2";"123.45"'));
 assert.equal(csv.split('\r\n').length,3);
 const files=unzip(exportArchiveXlsx(result,['main:A']));assert.doesNotMatch(Object.values(files).join(''),/<f[ >]/);assert.match(files['xl/worksheets/sheet1.xml'],/=HYPERLINK/);
});

test('archive export rejects broken selections, dimensions, invalid numbers and malformed header coordinates',()=>{
 const result=fixture();
 for(const exporter of [exportArchiveXlsx,exportArchiveCsv]){
  assert.throws(()=>exporter(result,[]),/хотя бы одну колонку/);assert.throws(()=>exporter(result,'main:A'),/хотя бы одну колонку/);
  assert.throws(()=>exporter(result,['main:A','main:A']),/не должны повторяться/);
  assert.throws(()=>exporter(result,['other:A']),/недоступная колонка/);
  const bad=fixture();bad.sheets[0].rows[0][1]=NaN;assert.throws(()=>exporter(bad),/нечисловое/);
  bad.sheets[0].rows[0]=['too short'];assert.throws(()=>exporter(bad),/Количество значений строки/);
 }
 assert.throws(()=>archiveColumnOptions({sheets:[]}),/нет листов/);
 const bad=fixture();bad.sheets[1].id=bad.sheets[0].id;assert.throws(()=>archiveColumnOptions(bad),/разные идентификаторы/);
 bad.sheets[1].id='fixed';bad.sheets[0].columns[1].id='A';assert.throws(()=>archiveColumnOptions(bad),/разные идентификаторы/);
 const malformed=fixture();malformed.sheets[0].headerCells={'A0':'bad'};assert.throws(()=>exportArchiveXlsx(malformed),/координата/);
 malformed.sheets[0].headerCells={'Z1':'bad'};assert.throws(()=>exportArchiveXlsx(malformed),/границы колонок/);
 malformed.sheets[0].headerCells={'A1':'ok'};malformed.sheets[0].merges=['A1:Z8'];assert.throws(()=>exportArchiveXlsx(malformed),/за границы отчета/);
 malformed.sheets[0].merges=['B2:A1'];assert.throws(()=>exportArchiveXlsx(malformed),/границы объединения/);
});

test('archive empty snapshots still retain all original headers and selected field headings',()=>{
 const result=fixture();result.sheets.forEach(s=>s.rows=[]);
 const full=unzip(exportArchiveXlsx(result));assert.match(full['xl/worksheets/sheet1.xml'],/<dimension ref="A1:D2"/);assert.match(full['xl/worksheets/sheet2.xml'],/<dimension ref="A1:C3"/);
 const selected=unzip(exportArchiveXlsx(result,['main:B']));assert.deepEqual(cells(selected['xl/worksheets/sheet1.xml']),{A1:'Результаты / Сумма'});
});
