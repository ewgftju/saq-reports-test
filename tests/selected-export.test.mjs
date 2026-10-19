import test from 'node:test';
import assert from 'node:assert/strict';
import {records,reports,defaultFilters,fieldMap} from '../data.js';
import {generate,templateMapping,templateValue} from '../engine.js';
import {templates} from '../templates.js';
import {exportColumnOptions,exportSelectedXlsx,exportSelectedCsv,colName} from '../export.js';

function unzip(bytes){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),decoder=new TextDecoder(),files={};let offset=0;
 while(offset+30<=bytes.length&&view.getUint32(offset,true)===0x04034b50){
  assert.equal(view.getUint16(offset+8,true),0);
  const size=view.getUint32(offset+18,true),nameLength=view.getUint16(offset+26,true),extraLength=view.getUint16(offset+28,true),start=offset+30+nameLength+extraLength;
  files[decoder.decode(bytes.slice(offset+30,offset+30+nameLength))]=decoder.decode(bytes.slice(start,start+size));offset=start+size;
 }
 assert.ok(files['xl/workbook.xml']);return files;
}
const decode=s=>s.replace(/&(amp|lt|gt|quot|apos);/g,(_,key)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[key]));
function cells(sheet){return [...sheet.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)].map(([,number,content])=>({number:Number(number),cells:[...content.matchAll(/<c r="([A-Z]+\d+)"([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)].map(([,ref,attributes,body=''])=>({ref,number:!attributes.includes('inlineStr'),value:attributes.includes('inlineStr')?decode(body.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1]||''):Number(body.match(/<v>(.*?)<\/v>/)?.[1])}))}));}
const resultFor=id=>{const report=reports.find(r=>r.id===id);return generate(records,{name:report.name,sources:report.source,columns:report.columns,group:report.group,template:report.template,filters:{...defaultFilters(),format:report.format||''}});};

test('the form catalog exposes all named original columns, including unmapped ones, and excludes service columns',()=>{
 for(const template of templates){
  const result=resultFor(template.id),options=exportColumnOptions(result,'form'),mapping=templateMapping(template.id);
  assert.deepEqual(options.map(option=>option.id),template.columns.filter(c=>c.labels.length).map(c=>`form:${c.letter}`));
  assert.equal(new Set(options.map(option=>option.id)).size,options.length);
  for(const option of options){
   const column=template.columns.find(c=>`form:${c.letter}`===option.id);
   assert.equal(option.label,column.labels.join(' / '));assert.equal(option.available,Boolean(mapping[column.letter]));
   assert.ok(option.group);assert.ok(!['в том числе','из них'].includes(option.group.toLowerCase()));
  }
  assert.ok(options.some(option=>!option.available));
  const financial=template.columns.find(c=>mapping[c.letter]==='financial');
  result.rows.forEach(r=>r.financial=null);
  assert.equal(exportColumnOptions(result,'form').find(c=>c.id===`form:${financial.letter}`).available,true,'source mapping is independent of whether values are populated');
 }
});

test('selected XLSX exports from all four forms preserve exact rows and numeric values with only requested columns',()=>{
 for(const template of templates){
  const result=resultFor(template.id),mapping=templateMapping(template.id),options=exportColumnOptions(result,'form');
  const financial=template.columns.find(c=>mapping[c.letter]==='financial'),identity=template.columns.find(c=>mapping[c.letter]===(template.id==='org'?'organ':'id'));
  const unavailable=options.find(c=>!c.available),ids=[`form:${financial.letter}`,unavailable.id,`form:${identity.letter}`];
  result.rows[0].unselectedSecret='DO_NOT_EXPORT_THIS_UNSELECTED_VALUE';
  const before=structuredClone(result),selected=options.filter(c=>ids.includes(c.id)),files=unzip(exportSelectedXlsx(result,'form',ids)),report=files['xl/worksheets/sheet1.xml'],parsed=cells(report);
  assert.deepEqual(result,before,'selection must not rerun, change config, or mutate the snapshot');
  assert.equal(parsed.length,result.rows.length+1);
  assert.deepEqual(parsed[0].cells.map(c=>c.value),selected.map(c=>c.label),'canonical form order, independent of click order');
  parsed.slice(1).forEach((row,index)=>{
   assert.equal(row.cells.length,3);
   selected.forEach((option,columnIndex)=>{
    const key=mapping[option.id.slice(5)],expected=key?templateValue(result.rows[index],key,index):'Нет данных';
    assert.equal(row.cells[columnIndex].value,expected,`${template.id} row ${index} ${option.id}`);
    if(key==='financial')assert.equal(row.cells[columnIndex].number,true,'amounts are native spreadsheet numbers');
   });
  });
  assert.match(report,new RegExp(`<autoFilter ref="A1:C${result.rows.length+1}"`));
  assert.match(files['xl/styles.xml'],/fgColor rgb="FFE7E6E6"/);
  for(const content of Object.values(files))assert.doesNotMatch(content,/DO_NOT_EXPORT_THIS_UNSELECTED_VALUE|<pane\b|state="frozen"/);
  assert.doesNotMatch(report,/mergeCell|ДЕМОНСТРАЦИОННЫЕ ДАННЫЕ|Не для официальной отчетности/);
  assert.equal(Object.keys(files).filter(name=>name.startsWith('xl/worksheets/')).length,2,'no hidden full-form sheet');
  const parameters=cells(files['xl/worksheets/sheet2.xml']);
  assert.deepEqual(parameters.filter(r=>String(r.cells[0].value).startsWith('Выбранная колонка ')).map(r=>r.cells[1].value),selected.map(c=>c.label));
  const csv=exportSelectedCsv(result,'form',ids);
  assert.ok(csv.startsWith('\uFEFF'+selected.map(c=>'"'+c.label.replaceAll('"','""')+'"').join(';')));
  assert.ok(csv.includes('"Нет данных"'));assert.ok(!csv.includes('DO_NOT_EXPORT_THIS_UNSELECTED_VALUE'));
 }
});

test('filtered and grouped report snapshots are projected without changing rows, grouping or totals',()=>{
 const filtered=resultFor('vga');filtered.config.filters.query=filtered.rows[2].id;
 const result=generate(records,filtered.config),ids=['field:financial','field:id'];
 assert.equal(result.rows.length,1);
 const rows=cells(unzip(exportSelectedXlsx(result,'report',ids))['xl/worksheets/sheet1.xml']);
 assert.equal(rows.length,2);assert.deepEqual(rows[1].cells.map(c=>c.value),[result.rows[0].id,result.rows[0].financial]);
 const grouped=resultFor('org'),groupedRows=cells(unzip(exportSelectedXlsx(grouped,'report',['field:financial']))['xl/worksheets/sheet1.xml']);
 assert.equal(groupedRows.length,grouped.rows.length+1);assert.deepEqual(groupedRows.slice(1).map(r=>r.cells[0].value),grouped.rows.map(r=>r.financial));
 assert.ok(groupedRows.every(r=>r.cells.length===1),'omitting a grouping label does not add it back or recompute results');
});

test('selected report exports preserve zero, decimals, dates, missing-value meaning and CSV formula escaping',()=>{
 const result={config:{name:'Выбор',sources:['ВГА'],group:'none',filters:defaultFilters()},createdAt:'2026-10-19T00:00:00Z',columns:['id','financial','deadline','object'],rows:[{id:'=2+2',financial:0,deadline:'2026-09-30',object:'NEVER_EXPORT_OBJECT'},{id:' +cmd;"x"',financial:19.75,deadline:null},{id:'@SUM(A1)',financial:null,deadline:null},{id:'-text',financial:-2,deadline:null}]};
 const ids=['field:deadline','field:financial','field:id'],files=unzip(exportSelectedXlsx(result,'report',ids)),sheet=files['xl/worksheets/sheet1.xml'],rows=cells(sheet);
 assert.deepEqual(rows[0].cells.map(c=>c.value),[fieldMap.id.label,fieldMap.financial.label,fieldMap.deadline.label]);
 assert.deepEqual(rows[1].cells.map(c=>c.value),['=2+2',0,'30.09.2026']);
 assert.deepEqual(rows[2].cells.map(c=>c.value),[' +cmd;"x"',19.75,'Нет данных']);
 assert.deepEqual(rows[3].cells.map(c=>c.value),['@SUM(A1)','Нет данных','Нет данных']);
 assert.match(sheet,/<c r="B2" s="3"><v>0<\/v>/);assert.match(sheet,/<c r="B3" s="2"><v>19.75<\/v>/);
 assert.ok(Object.values(files).every(value=>!value.includes('NEVER_EXPORT_OBJECT')));
 const csv=exportSelectedCsv(result,'report',ids);
 assert.ok(csv.includes('"\'=2+2";"0";"30.09.2026"'));
 assert.ok(csv.includes('"\' +cmd;""x""";"19.75";"Нет данных"'));
 assert.ok(csv.includes('"\'@SUM(A1)";"Нет данных";"Нет данных"'));
 assert.ok(csv.includes('"\'-text";"-2";"Нет данных"'),'negative numbers stay numeric text, negative text is escaped');
});

test('VGA and objections column selection cannot export unselected linked risk details',()=>{
 const result=generate(records,{name:'ВГА + Возражения',dataset:'case-links',sources:['ВГА','СУР','Возражения'],group:'none',columns:['id','object','financial','objectionCount','cancelled','balance'],filters:defaultFilters()});
 assert.deepEqual(exportColumnOptions(result,'report').map(c=>c.id),result.columns.map(key=>`field:${key}`));
 assert.ok(!exportColumnOptions(result,'report').some(c=>c.id==='field:score'||c.id==='field:risk'));
 const ids=['field:cancelled','field:id','field:objectionCount'];
 const files=unzip(exportSelectedXlsx(result,'report',ids)),rows=cells(files['xl/worksheets/sheet1.xml']);
 assert.deepEqual(rows[1].cells.map(c=>c.value),['VGA-LINK-001',2,200]);
 assert.doesNotMatch(Object.values(files).join(''),/RISK-001|Высокий|Балл риска|Уровень риска/);
 assert.throws(()=>exportSelectedXlsx(result,'report',['field:risk']),/недоступная колонка/);
});

test('export selection rejects empty, duplicate, unknown, cross-scope ids and absent templates',()=>{
 const result=resultFor('vga');
 for(const exporter of [exportSelectedXlsx,exportSelectedCsv]){
  for(const ids of [[],null,'field:id'])assert.throws(()=>exporter(result,'report',ids),/хотя бы одну колонку/);
  assert.throws(()=>exporter(result,'report',['field:id','field:id']),/не должны повторяться/);
  for(const [scope,ids]of [['report',['field:never']],['report',['form:C']],['form',['field:id']],['form',['form:A']]])assert.throws(()=>exporter(result,scope,ids),/недоступная колонка/);
  assert.throws(()=>exporter(result,'other',['field:id']),/доступный состав/);
  assert.throws(()=>exporter({...result,config:{...result.config,template:null}},'form',['form:C']),/нет исходной формы/);
 }
 assert.throws(()=>exportColumnOptions(result,'other'),/доступный состав/);
 assert.throws(()=>exportColumnOptions({...result,config:{...result.config,template:'missing'}},'form'),/нет исходной формы/);
});

test('empty results still create a selectable one-row table with selected headers only',()=>{
 const result=resultFor('vga');result.rows=[];
 const sheet=unzip(exportSelectedXlsx(result,'report',['field:financial','field:id']))['xl/worksheets/sheet1.xml'];
 assert.match(sheet,new RegExp(`<dimension ref="A1:${colName(2)}1"`));assert.match(sheet,/<autoFilter ref="A1:B1"/);
 assert.equal(cells(sheet).length,1);assert.equal(cells(sheet)[0].cells.length,2);
});


test('text identifiers retain an explicit text format and their exact digits',()=>{
 const r=generate(records,{name:'БИН',sources:['ВГА'],group:'none',columns:['id','bin'],filters:defaultFilters()});
 const files=unzip(exportSelectedXlsx(r,'report',['field:bin']));
 assert.match(files['xl/styles.xml'],/numFmtId="49"/);
 assert.match(files['xl/worksheets/sheet1.xml'],/t="inlineStr" s="4"[^]*?990000000001/);
});
