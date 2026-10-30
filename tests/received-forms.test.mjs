import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {receivedForms} from '../received-schemas.js';
import {generateReceivedReport,receivedReportDescriptions} from '../received-engine.js';
import {records,defaultFilters} from '../data.js';
import {exportArchiveXlsx} from '../export.js';

const form=id=>receivedForms.find(item=>item.id===id);
const generate=(id,filters=defaultFilters(),source)=>{
 const schema=form(id),config={name:schema.name,dataset:'archive',archiveFormId:id,reportId:id,filters,sources:schema.sources,group:'none',columns:[],...receivedReportDescriptions[id]};
 return generateReceivedReport(schema,config,source);
};
const cell=(result,letter,index)=>{const sheet=result.sheets[0];const row=index??Math.max(0,sheet.rows.findIndex(row=>row.includes('г.Астана')));return sheet.rows[row][sheet.columns.findIndex(column=>column.id===letter)];};
const base=(id,props={})=>({...records.find(row=>row.module==='ВГА'),id,organ:'ДВГА тест',region:'г. Астана',...props});
const plan=(quarter,props={})=>({year:2026,quarter,kind:'Соответствие',coverage:10000,assignedAt:null,completedAt:null,excludedAt:null,...props});

test('six supplied workbooks preserve every intended column and numeric quarter/year headers',()=>{
 assert.equal(receivedForms.length,6);
 assert.deepEqual(receivedForms.map(item=>item.sheets[0].columnCount),[14,28,15,6,9,12]);
 assert.deepEqual(receivedForms.map(item=>item.departmentId),['digital-risks','digital-risks','digital-risks','digital-risks','digital-risks','quality']);
 const monitor=form('received-plan-monitoring').sheets[0];
 assert.deepEqual(['E2','I2','M2','R2'].map(ref=>monitor.headerCells[ref]),[1,2,3,4]);
 assert.equal(monitor.columns.find(column=>column.letter==='M').labels.join(' / '),'Кварталы / 3 / План');
 assert.equal(form('received-plan-summary').sheets[0].headerCells.D1,2026);
 assert.equal(form('received-quality-journal').sheets[0].headerDepth,3);
 for(const schema of receivedForms){
  const result=generate(schema.id),sheet=result.sheets[0];
  assert.ok(sheet.rows.length>0,schema.id);
  assert.equal(sheet.columns.length,schema.sheets[0].columnCount);
  assert.ok(sheet.rows.every(row=>row.length===sheet.columns.length));
  assert.ok(exportArchiveXlsx(result).byteLength>1000);
 }
});

test('monitoring uses full annual plan, planned quarters and events as of cutoff, not audit report dates',()=>{
 const source=[
  base('A',{date:'2025-01-01',plan:plan(1,{assignedAt:'2026-01-10',completedAt:'2026-02-10'})}),
  base('B',{date:'2026-12-31',plan:plan(3,{assignedAt:'2026-08-01',completedAt:'2026-10-01'})}),
  base('C',{plan:plan(3)}),
  base('D',{plan:plan(4,{assignedAt:'2026-10-01'})}),
  base('EXCLUDED',{plan:plan(2,{excludedAt:'2026-07-01'})}),
  base('PREVIOUS',{plan:{...plan(1),year:2025}}),
 ];
 const result=generate('received-plan-monitoring',{...defaultFilters(),from:'2026-09-01'},source);
 assert.equal(result.recordCount,4);
 assert.equal(cell(result,'D'),4);
 assert.equal(cell(result,'M'),2);assert.equal(cell(result,'N'),1);assert.equal(cell(result,'O'),1);
 assert.equal(cell(result,'P'),0);assert.equal(cell(result,'Q'),2);
 assert.equal(cell(result,'R'),1);assert.equal(cell(result,'S'),0);
 assert.equal(cell(result,'V'),['E','I','M','R'].reduce((total,col)=>total+cell(result,col),0));
 assert.equal(cell(result,'W'),2);assert.equal(cell(result,'X'),50);
 assert.equal(cell(result,'Y'),1);assert.equal(cell(result,'Z'),25);
 assert.equal(cell(result,'AA'),3);assert.equal(cell(result,'AB'),75);
 const later=generate('received-plan-monitoring',{...defaultFilters(),to:'2026-12-31'},source);
 assert.equal(cell(later,'Y'),2);assert.equal(cell(later,'W'),3);
});

test('plan summary reconciles AS/AFO and quarterly planned coverage in millions without actual-coverage substitution',()=>{
 const source=[base('A',{coverage:999999,plan:plan(1,{coverage:12000})}),base('B',{plan:plan(3,{coverage:23000})}),base('C',{plan:plan(2,{kind:'Финансовая отчетность',coverage:87000})})];
 const result=generate('received-plan-summary',defaultFilters(),source);
 assert.equal(cell(result,'D'),3);assert.equal(cell(result,'E'),2);assert.equal(cell(result,'O'),1);
 assert.equal(cell(result,'F'),122);assert.equal(cell(result,'H'),12);assert.equal(cell(result,'J'),87);assert.equal(cell(result,'L'),23);
 assert.equal(cell(result,'F'),['H','J','L','N'].reduce((total,col)=>total+cell(result,col),0));
 assert.equal(cell(result,'D'),['G','I','K','M'].reduce((total,col)=>total+cell(result,col),0));
 const future=generate('received-plan-summary',{...defaultFilters(),to:'2027-09-30'},[base('F',{plan:{...plan(1),year:2027}})]);
 assert.equal(future.sheets[0].headerCells.D1,2027);
 assert.ok(future.sheets[0].columns.find(column=>column.id==='D').label.includes('2027'));
});

test('electronic rating keeps all audits in denominator and only electronic violations in amounts',()=>{
 const source=[base('E',{format:'Электронный',financial:10000,procedural:2000}),base('P1',{format:'Бумажный',financial:99000,procedural:99000}),base('P2',{format:'Бумажный',financial:99000,procedural:99000}),base('P3',{format:'Бумажный',financial:99000,procedural:99000})];
 const result=generate('received-electronic-rating',defaultFilters(),source);
 assert.equal(cell(result,'D'),4);assert.equal(cell(result,'E'),1);assert.equal(cell(result,'F'),25);
 assert.equal(cell(result,'G'),-4);assert.equal(cell(result,'H'),10);assert.equal(cell(result,'I'),2);
 const noElectronic=generate('received-electronic-rating',defaultFilters(),source.slice(1));
 assert.equal(cell(noElectronic,'E'),0);assert.equal(cell(noElectronic,'F'),0);assert.equal(cell(noElectronic,'G'),-29);assert.equal(cell(noElectronic,'H'),0);
 const unknownFormat=generate('received-electronic-rating',defaultFilters(),[base('?',{format:null})]);
 assert.equal(cell(unknownFormat,'E'),'Нет данных');assert.equal(cell(unknownFormat,'F'),'Нет данных');
});

test('agreement report counts explicit decisions by decision date and never substitutes orders',()=>{
 const source=[base('A',{date:'2025-01-01',orders:999,executed:999,assignmentDecisions:[{date:'2026-09-01',result:'Подтверждено'},{date:'2026-09-02',result:'Отклонено',reason:'Причина 1'},{date:'2026-10-01',result:'Подтверждено'}]}),base('B',{assignmentDecisions:[{date:'2026-08-01',result:'Подтверждено'}]})];
 const result=generate('received-assignment-decisions',{...defaultFilters(),from:'2026-09-01'},source);
 assert.equal(result.recordCount,1);assert.equal(cell(result,'C'),2);assert.equal(cell(result,'D'),1);assert.equal(cell(result,'E'),1);assert.equal(cell(result,'F'),'Причина 1');
});

test('quality journal selects negative conclusions by quality date, not audit date',()=>{
 const source=[base('Q1',{date:'2025-01-01',qualityChecks:[{date:'2026-09-02',result:'Не соответствуют Стандартам ГАФК',reviewer:'Тест КК',responsible:'Тест руководитель',basis:'Тест основание'}]}),base('Q2',{qualityChecks:[{date:'2026-09-02',result:'Соответствуют Стандартам ГАФК'}]}),base('Q3',{qualityChecks:[{date:'2026-10-01',result:'Не соответствуют Стандартам ГАФК'}]})];
 const result=generate('received-quality-journal',{...defaultFilters(),from:'2026-09-01'},source);
 assert.equal(result.recordCount,1);assert.equal(result.sheets[0].rows.length,1);assert.equal(cell(result,'B'),'2026-09-02');assert.equal(cell(result,'C'),'Q1');assert.equal(cell(result,'J'),'Тест КК');
});

test('summary totals recalculate weighted shares and preserve only meaningful total cells',()=>{
 const source=[base('E',{organ:'Первый',region:'г. Астана',format:'Электронный',financial:1000,procedural:0}),...Array.from({length:3},(_,index)=>base(`P${index}`,{organ:'Второй',region:'г. Алматы',format:'Бумажный',financial:99000,procedural:99000}))];
 const result=generate('received-electronic-rating',defaultFilters(),source),total=result.sheets[0].rows.length-1;
 assert.equal(cell(result,'B',total),'ИТОГО');assert.equal(cell(result,'C',total),null);
 assert.equal(cell(result,'D',total),4);assert.equal(cell(result,'E',total),1);assert.equal(cell(result,'F',total),25);assert.equal(cell(result,'G',total),-4);assert.equal(cell(result,'H',total),1);
 const detailed=generate('received-plan-detail',defaultFilters(),[base('A',{financial:5000,procedural:1000,plan:plan(1,{coverage:10000,completedAt:'2026-02-01'})}),base('B',{financial:7000,procedural:0,plan:plan(2,{coverage:20000,completedAt:'2026-06-01'})})]);
 const final=detailed.sheets[0].rows.length-1;
 assert.equal(cell(detailed,'B',final).trim(),'Итого');assert.equal(cell(detailed,'J',final),30);assert.equal(cell(detailed,'K',final),13);assert.equal(cell(detailed,'L',final),12);assert.equal(cell(detailed,'M',final),1);assert.equal(cell(detailed,'A',final),null);
});

test('detail preserves planned amount and only exposes completed results at the selected date',()=>{
 const source=[base('D',{coverage:999999,financial:5000,procedural:1000,plan:plan(3,{coverage:12000,assignedAt:'2026-07-01',completedAt:'2026-10-01',orderNumber:'TEST'})})];
 const before=generate('received-plan-detail',defaultFilters(),source);
 assert.equal(cell(before,'J'),12);assert.equal(cell(before,'K'),'Нет данных');assert.equal(cell(before,'G'),'Нет данных');
 const after=generate('received-plan-detail',{...defaultFilters(),to:'2026-12-31'},source);
 assert.equal(cell(after,'K'),6);assert.equal(cell(after,'L'),5);assert.equal(cell(after,'M'),1);assert.equal(cell(after,'G'),4);
});

test('custom records are not silently enriched; real zeros remain distinct from missing facts',()=>{
 const custom=[{...records.find(row=>row.module==='ВГА')}];
 for(const id of ['received-plan-monitoring','received-plan-summary'])assert.equal(cell(generate(id,defaultFilters(),custom),'D'),'Нет данных');
 assert.equal(cell(generate('received-assignment-decisions',defaultFilters(),custom),'C'),'Нет данных');
 assert.equal(generate('received-quality-journal',defaultFilters(),custom).recordCount,0);
 const known=generate('received-plan-detail',defaultFilters(),[base('ZERO',{financial:0,procedural:0,plan:plan(1,{coverage:0,completedAt:'2026-01-05'})})]);
 assert.equal(cell(known,'J'),0);assert.equal(cell(known,'K'),0);
 assert.throws(()=>generate('received-electronic-rating',defaultFilters(),[custom[0],{...custom[0],financial:123}]),/Противоречивые/);
 const dedup=generate('received-electronic-rating',defaultFilters(),[custom[0],custom[0]]);assert.equal(dedup.recordCount,1);
});

test('schema and generated exports contain structural headers and no supplied personal observation',async()=>{
 const source=await readFile(new URL('../received-schemas.js',import.meta.url),'utf8');
 const historicalCaseNumber=/\b\d{5}-\d{2}-\d{4,}\b/;
 assert.doesNotMatch(source,historicalCaseNumber);
 assert.doesNotMatch(source,/\b\d{12}\b/);
 for(const schema of receivedForms){const exported=new TextDecoder().decode(exportArchiveXlsx(generate(schema.id)));assert.doesNotMatch(exported,historicalCaseNumber);}
 const bytes=new TextDecoder().decode(exportArchiveXlsx(generate('received-plan-monitoring')));
 for(const quarter of [1,2,3,4])assert.ok(bytes.includes(`<v>${quarter}</v>`));
 assert.match(bytes,/Остаток/);assert.match(bytes,/Не назначено/);
});

test('source layout preserves original sheet names, titles, column numbering and fixed territorial rows',()=>{
 assert.deepEqual(receivedForms.map(form=>form.sheets[0].name),['Перечень  2025 г ','лист','лист','Лист1','лист','Лист1']);
 const monitor=generate('received-plan-monitoring').sheets[0].templateLayout;
 assert.equal(monitor.cells.Z1,'Приложение 1 \n');
 assert.match(monitor.cells.B4,/МОНИТОРИНГ ИСПОЛНЕНИЯ ПЕРЕЧНЯ \n/);
 assert.equal(monitor.cells.D11,6);assert.equal(monitor.cells.AB11,25);
 assert.equal(monitor.cells.C12,'Жетису');assert.equal(monitor.cells.C31,'Костанай');
 assert.equal(monitor.cells.B32,'Всего по ДВГА');assert.equal(monitor.cells.C33,'УАС');assert.equal(monitor.cells.C34,'УАФО');assert.equal(monitor.cells.C35,'УР (УАС, УАФО)');
 assert.equal(monitor.cells.B36,'Всего по КВГА');assert.equal(monitor.cells.B37,'ИТОГО');
 assert.equal(monitor.rowCount,47);assert.ok(monitor.merges.includes('B41:Y41'));assert.ok(monitor.merges.includes('B37:C37'));
 const rating=generate('received-electronic-rating').sheets[0].templateLayout;
 assert.equal(rating.cells.B9,1);assert.equal(rating.cells.I9,8);assert.equal(rating.cells.C10,'Жамбыл');assert.equal(rating.cells.C29,'Алматинская');
 assert.equal(rating.cells.C30,undefined);assert.equal(rating.cells.C31,'ЦА');assert.equal(rating.cells.B32,'ИТОГО');
 assert.equal(rating.rowCount,32);assert.ok(rating.merges.includes('B32:C32'));
 const summary=generate('received-plan-summary').sheets[0].templateLayout;
 assert.equal(summary.cells.C7,'Абай');assert.equal(summary.cells.C26,'г.Шымкент');assert.equal(summary.cells.C27,'ЦА');assert.equal(summary.cells.B28,'Итого:');
 const assignments=generate('received-assignment-decisions').sheets[0].templateLayout;
 assert.equal(assignments.cells.A11,1);assert.equal(assignments.cells.F11,6);assert.equal(assignments.cells.B12,'Абай');assert.equal(assignments.cells.B31,'Улытау');assert.equal(assignments.cells.A32,'Всего');
});

test('source widths, heights, print settings and TNR are preserved instead of generic table defaults',()=>{
 const rating=form('received-electronic-rating').sheets[0].templateLayout;
 assert.equal(rating.columnWidths.C,23);assert.equal(rating.columnWidths.G,16.28515625);assert.equal(rating.rowHeights[3],38.25);
 assert.equal(rating.pageSetup.orientation,'portrait');assert.equal(rating.pageSetup.scale,75);
 const monitor=form('received-plan-monitoring').sheets[0].templateLayout;
 assert.equal(monitor.pageSetup.scale,57);assert.equal(monitor.printArea,"'лист'!$A$1:$AB$47");
 const detail=form('received-plan-detail').sheets[0].templateLayout;
 assert.equal(detail.pageSetup.orientation,'landscape');assert.equal(detail.pageSetup.scale,38);assert.equal(detail.columnWidths.B,41);assert.equal(detail.rowHeights[6],69);
 for(const source of receivedForms)for(const style of source.sheets[0].templateLayout.styles)assert.equal(style.font.name,'Times New Roman');
});

test('variable forms keep source blank slots and shift totals/styles only when data exceeds the template',()=>{
 const empty=generate('received-plan-detail',defaultFilters(),[]).sheets[0];
 assert.equal(empty.templateLayout.rowCount,13);assert.equal(empty.templateLayout.cells.B12,'Итого ');
 const long=generate('received-plan-detail').sheets[0];
 assert.equal(long.templateLayout.rowCount,34);assert.equal(long.templateLayout.cells.B33,'Итого ');
 assert.equal(long.templateLayout.rowHeights[32],form('received-plan-detail').sheets[0].templateLayout.rowHeights[11]);
 const journal=generate('received-quality-journal').sheets[0];
 assert.equal(journal.templateLayout.rowCount,12);assert.equal(journal.templateLayout.rowHeights[12],89.25);
 assert.match(journal.templateLayout.cells.F1,/с 01\.01\.2026г\. по 30\.09\.2026г\./);
});

test('fixed forms aggregate central/territorial totals separately and reject unmapped departments',()=>{
 const data=[base('D',{plan:plan(1)}),base('C',{organ:'УАС',centralUnit:'УАС',plan:plan(2)})];
 const layout=generate('received-plan-monitoring',defaultFilters(),data).sheets[0].templateLayout;
 assert.equal(layout.cells.D24,1);assert.equal(layout.cells.D32,1);assert.equal(layout.cells.D33,1);assert.equal(layout.cells.D36,1);assert.equal(layout.cells.D37,2);
 assert.equal(layout.cells.D34,undefined);
 assert.throws(()=>generate('received-electronic-rating',defaultFilters(),[base('UNKNOWN',{organ:'Неизвестное управление',region:'Неизвестный регион'})]),/не сопоставлено/);
});
