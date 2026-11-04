import test from 'node:test';
import assert from 'node:assert/strict';
import {archiveForms,formDepartment,formNumber} from '../form-registry.js';
import {archiveConfig,generateArchiveReport} from '../archive-engine.js';
import {archiveFilters,archiveResultPanel} from '../archive-ui.js';
import {catalogReports} from '../catalog.js';
import {exportArchiveXlsx,archiveColumnOptions} from '../export.js';
import {defaultFilters} from '../data.js';

const id='personnel-kvga-staff',missing='Нет данных';
const person=(id,sectionId='leadership',overrides={})=>({id,sectionId,
 position:'Учебная должность',fullName:`Учебный сотрудник ${id}`,note:'',
 startDate:'2026-01-01',endDate:null,...overrides});
const generate=(source,filters={})=>generateArchiveReport(id,{...defaultFilters(),to:'2026-11-04',...filters},source);
const cells=report=>report.sheets[0].templateLayout.cells;
const schema=archiveForms.find(form=>form.id===id)?.sheets[0];
const decode=value=>value.replace(/&(amp|lt|gt|quot|apos);/g,(_,key)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[key]));
const attr=(value,key,fallback='')=>value.match(new RegExp(`\\b${key}="([^"]*)"`))?.[1]??fallback;
function exported(report){
 const bytes=exportArchiveXlsx(report),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),decoder=new TextDecoder(),files={};
 for(let offset=0;offset+30<=bytes.length&&view.getUint32(offset,true)===0x04034b50;){
  assert.equal(view.getUint16(offset+8,true),0);
  const size=view.getUint32(offset+18,true),name=view.getUint16(offset+26,true),extra=view.getUint16(offset+28,true),start=offset+30+name+extra;
  files[decoder.decode(bytes.slice(offset+30,offset+30+name))]=decoder.decode(bytes.slice(start,start+size));offset=start+size;
 }
 const names=[...files['xl/workbook.xml'].matchAll(/<sheet\b([^>]*)\/?\s*>/g)].map(m=>decode(attr(m[1],'name'))),output={};
 for(const match of files['xl/worksheets/sheet1.xml'].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){
  const body=match[2]||'',text=[...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m=>decode(m[1])).join(''),number=body.match(/<v>([^<]*)<\/v>/)?.[1];
  if(text!=='')output[attr(match[1],'r')]=text;else if(number!==undefined)output[attr(match[1],'r')]=Number(number);
 }
 return {files,names,cells:output};
}

test('the staff form replaces the existing first personnel catalog position and preserves four fields',()=>{
 const form=archiveForms.find(form=>form.id===id);
 assert.equal(formDepartment(form),'personnel');assert.equal(formNumber(form),1);assert.equal(form.engine,'personnel');
 assert.deepEqual(form.sources,[]);assert.equal(form.sheets.length,1);assert.equal(schema.name,'Лист1');
 assert.equal(schema.columnCount,5);assert.equal(schema.templateLayout.rowCount,174);
 assert.deepEqual(schema.columns.filter(c=>c.labels.length).map(c=>[c.letter,c.labels[0]]),
  [['B','№'],['C','Наименование должности'],['D','ФИО'],['E','Примечание']]);
 assert.equal(schema.sections.length,12);assert.equal(schema.dataRows.length,117);
 const matching=catalogReports.filter(report=>report.departmentId==='personnel'&&report.number===1);
 assert.equal(matching.length,1);assert.equal(matching[0].archiveFormId,id);
});

test('empty explicit personnel data preserves source numbering, sections and empty staff fields',()=>{
 const report=generate([]),output=exported(report).cells;
 assert.equal(report.recordCount,0);assert.equal(output.B74,50);assert.equal(output.B88,60);assert.equal(output.B93,60);
 assert.equal(output.B5,'Руководство');assert.match(output.B14,/Управление работы с персоналом/);
 assert.match(output.B160,/взаимодействию/);
 for(const row of schema.dataRows)for(const column of ['C','D','E'])assert.equal(output[column+row.sourceRow],undefined);
 assert.equal(report.sheets[0].rows.length,129,'12 section headers and 117 original slots');
});

test('as-of date includes first and last working days and ignores audit-period start',()=>{
 const source=[person('open'),person('boundary','personnel',{startDate:'2026-11-04',endDate:'2026-11-04'}),
  person('future','legal',{startDate:'2026-11-05'}),person('left','quality',{endDate:'2026-11-03'})];
 const report=generate(source,{from:'2030-01-01'}),output=cells(report);
 assert.equal(report.recordCount,2);assert.equal(report.config.filters.from,'2026-11-04');
 assert.equal(output.D6,'Учебный сотрудник open');assert.equal(output.D15,'Учебный сотрудник boundary');
 assert.equal(output.D40,undefined);assert.equal(output.D51,undefined);
 assert.equal(generate(source,{to:'2026-11-05'}).recordCount,2);
 assert.equal(generate(source,{to:'2025-12-31'}).recordCount,0);
});

test('employees populate their own sections and are counted without audit objects',()=>{
 const source=[person('legal','legal',{position:'Учебный юрист',note:'Учебное примечание'}),
  person('analysis','uao',{position:'Учебный аналитик'}),person('coop','audit-cooperation')];
 const report=generate(source),output=exported(report).cells;
 assert.equal(report.recordCount,3);assert.equal(report.objectCount,0);
 assert.equal(output.C40,'Учебный юрист');assert.equal(output.D40,'Учебный сотрудник legal');assert.equal(output.E40,'Учебное примечание');
 assert.equal(output.D93,'Учебный сотрудник analysis');assert.equal(output.D161,'Учебный сотрудник coop');
 assert.equal(output.D6,undefined);
 const rows=report.sheets[0].sourceRowNumbers;
 assert.equal(rows.length,15);assert.ok(rows.includes(40)&&rows.includes(93)&&rows.includes(161));
});

test('populated exports number slots consecutively while leaving the original schema immutable',()=>{
 const output=cells(generate([person('a')]));
 assert.equal(output.B74,49);assert.equal(output.B88,59);assert.equal(output.B93,60);
 const ordinals=schema.dataRows.map(row=>output[`B${row.sourceRow}`]);
 assert.deepEqual(ordinals,Array.from({length:117},(_,index)=>index+1));
 assert.equal(schema.templateLayout.cells.B74,50);assert.equal(cells(generate([])).B88,60);
});

test('search finds name, position, note and section label case-insensitively',()=>{
 const source=[person('one','personnel',{fullName:'Учебный Ёлкин',position:'Главный эксперт',note:'Временное назначение'}),
  person('two','legal',{fullName:'Учебный Другой',position:'Юрист'})];
 for(const query of ['ЕЛКИН','главный эксперт','ВРЕМЕННОЕ','работы с персоналом']){
  const report=generate(source,{query});assert.equal(report.recordCount,1,query);assert.equal(cells(report).D15,'Учебный Ёлкин');
 }
 assert.equal(generate(source,{query:'нет совпадения'}).recordCount,0);
});

test('missing and whitespace-only position/name become unavailable while optional notes stay blank',()=>{
 const report=generate([person('missing','leadership',{fullName:null,position:undefined,note:undefined}),
  person('spaces','leadership',{fullName:'   ',position:'\t  ',note:''})]),output=exported(report).cells;
 for(const row of [6,7]){assert.equal(output[`C${row}`],missing);assert.equal(output[`D${row}`],missing);assert.equal(output[`E${row}`],undefined);}
});

test('identical records deduplicate and conflicting identities fail instead of overwriting',()=>{
 const source=person('same');assert.equal(generate([source,structuredClone(source)]).recordCount,1);
 assert.throws(()=>generate([source,{...source,fullName:'Другое учебное имя'}]),/Противоречив/);
 assert.throws(()=>generate([source,{...source,sectionId:'legal'}]),/Противоречив/);
 assert.equal(generate([source,{...source,endDate:undefined,note:undefined}]).recordCount,1);
});

test('unknown sections, malformed identities and impossible employment dates fail explicitly',()=>{
 for(const override of [{sectionId:'unknown'},{id:''},{id:2},{startDate:undefined},{startDate:'2026-02-30'},
  {endDate:'2026-02-30'},{startDate:'2026-11-05',endDate:'2026-11-04'},{fullName:3},{position:[]}])
  assert.throws(()=>generate([person('invalid','leadership',override)]),/Подразделение|идентификатор|дат|предшествует|текстовые/);
 assert.throws(()=>generate({users:[]}),/список кадровых/);
 assert.throws(()=>generate([],{to:'2026-02-30'}),/дат/);
});

test('audit filters cannot silently narrow the personnel report',()=>{
 for(const filter of [{region:'г. Астана'},{organ:'КВГА'},{status:'Завершено'},{kind:'Соответствие'},{format:'Электронный'},
  {included:'Да'},{minFinancial:'10'},{onlyOverdue:true}])
  assert.throws(()=>generate([person('a')],filter),/кадровом отч/);
});

test('overflow stays within its section and shifts later headers, merges and footer',()=>{
 const source=[...Array.from({length:7},(_,i)=>person(`leader-${i}`)),person('hr','personnel'),person('law','legal')];
 const report=generate(source),sheet=report.sheets[0],output=exported(report).cells;
 assert.equal(report.recordCount,9);assert.equal(sheet.templateLayout.rowCount,176);
 assert.equal(output.D12,'Учебный сотрудник leader-6');assert.match(output.B16,/Управление работы с персоналом/);
 assert.equal(output.D17,'Учебный сотрудник hr');assert.equal(output.B41,'Юридическое управление');assert.equal(output.D42,'Учебный сотрудник law');
 assert.ok(sheet.templateLayout.merges.includes('B16:D16'));assert.ok(sheet.templateLayout.merges.includes('B172:D172'));
 assert.equal(output.B6,1);assert.equal(output.B12,7);assert.equal(output.B17,8);
});

test('two overflowing sections keep distinct employees and correct cumulative shifts',()=>{
 const source=[...Array.from({length:6},(_,i)=>person(`leader-${i}`)),
  ...Array.from({length:12},(_,i)=>person(`hr-${i}`,'personnel')),person('law','legal')];
 const report=generate(source),output=cells(report);
 assert.equal(report.recordCount,19);assert.equal(report.sheets[0].templateLayout.rowCount,177);
 assert.match(output.B15,/Управление работы с персоналом/);assert.equal(output.D27,'Учебный сотрудник hr-11');
 assert.equal(output.B42,'Юридическое управление');assert.equal(output.D43,'Учебный сотрудник law');
 const numbers=Object.entries(output).filter(([ref,value])=>/^B\d+$/.test(ref)&&typeof value==='number').sort((a,b)=>Number(a[0].slice(1))-Number(b[0].slice(1))).map(([,value])=>value);
 assert.deepEqual(numbers,Array.from({length:120},(_,i)=>i+1));
});

test('personnel controls expose one date and search and preview staff sections without audit counters',()=>{
 const config=archiveConfig(id,{...defaultFilters(),to:'2026-11-04'}),filters=archiveFilters(config);
 assert.deepEqual([...filters.matchAll(/data-filter="([^"]+)"/g)].map(m=>m[1]),['to','query']);
 assert.match(filters,/По состоянию на/);assert.doesNotMatch(filters,/БИН|Орган аудита|Период с/);
 const report=generate([person('a')]),preview=archiveResultPanel(report,report.sheets[0].id);
 assert.match(preview,/Сотрудников/);assert.match(preview,/<strong>Руководство<\/strong>/);
 assert.match(preview,/Учебный сотрудник a/);assert.doesNotMatch(preview,/Объектов:/);
 assert.doesNotMatch(filters+preview,/Times New Roman/);
});

test('actual XLSX uses four source fields, Times New Roman, one sheet and no frozen panes or formulas',()=>{
 const report=generate([person('safe','leadership',{fullName:'=USER()',note:'<учебное примечание>'})]),book=exported(report);
 assert.deepEqual(book.names,['Лист1']);assert.equal(book.cells.D6,'=USER()');assert.equal(book.cells.E6,'<учебное примечание>');
 const xml=book.files['xl/worksheets/sheet1.xml'];
 assert.match(xml,/<dimension ref="A1:E174"/);assert.doesNotMatch(xml,/<pane\b|<f(?:\s|>)|NaN|Infinity|#REF!/);
 assert.deepEqual(numberedHeadings(book.cells),['№','Наименование должности','ФИО','Примечание']);
 const fonts=[...book.files['xl/styles.xml'].match(/<fonts\b[^>]*>([\s\S]*?)<\/fonts>/)[1].matchAll(/<name\b[^>]*val="([^"]+)"/g)].map(m=>m[1]);
 assert.ok(fonts.length&&fonts.every(font=>font==='Times New Roman'));
 for(const ref of Object.keys(book.cells))assert.match(ref,/^[A-E]\d+$/);
 assert.doesNotMatch(xml,/startDate|endDate|sectionId|DEMO-STAFF|2026-01-01/);
});
test('selectable exports offer only the four meaningful fields and reject the blank A margin',()=>{
 const report=generate([person('selected')]),options=archiveColumnOptions(report);
 assert.equal(options.length,4);assert.deepEqual(options.map(option=>option.columnId),['B','C','D','E']);
 assert.throws(()=>exportArchiveXlsx(report,[`${report.sheets[0].id}:A`]),/Неизвест|недоступ|не найден|пол/);
 assert.doesNotThrow(()=>exportArchiveXlsx(report,options.map(option=>option.id)));
});
function numberedHeadings(output){return ['B1','C1','D1','E1'].map(ref=>output[ref]);}

test('the separate demo uses staff data and an explicit empty source never falls back to audit records',()=>{
 const report=generateArchiveReport(id,{...defaultFilters(),to:'2026-11-04'});
 assert.ok(report.recordCount>0);assert.equal(report.objectCount,0);
 assert.match(cells(report).D6,/Учебный сотрудник/);assert.equal(generate([]).recordCount,0);
 assert.throws(()=>generate([{id:'AUDIT-1',module:'ВГА',object:'Учебный объект',date:'2026-11-04'}]),/Подразделение/);
});
