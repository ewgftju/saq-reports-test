import test from 'node:test';
import assert from 'node:assert/strict';
import {records,defaultFilters} from '../data.js';
import {archiveForms} from '../form-registry.js';
import {archiveDemoFacts} from '../archive-demo-data.js';
import {generateArchiveReport,archiveConfig,validateArchiveFilters,archiveCoverage,ARCHIVE_MISSING as missing} from '../archive-engine.js';
const base=records.filter(r=>r.module==='ВГА');
const cell=(sheet,row,letter)=>sheet.rows[row][sheet.columns.findIndex(c=>c.id===letter)];
const find=(sheet,id)=>sheet.rows.findIndex(row=>row.includes(id));
const report=(id,filters=defaultFilters(),source)=>generateArchiveReport(id,filters,source).sheets[0];

test('all active source forms generate every sheet with their full original column structure',()=>{
 assert.equal(archiveForms.length,32);assert.equal(archiveForms.reduce((n,f)=>n+f.sheets.length,0),41);
 for(const form of archiveForms){const output=generateArchiveReport(form.id);assert.equal(output.sheets.length,form.sheets.length);assert.deepEqual(output.config,archiveConfig(form.id));
  for(const [i,sheet]of output.sheets.entries()){assert.equal(sheet.columns.length,form.sheets[i].columnCount);assert.ok(sheet.rows.length>0,form.id);assert.ok(sheet.columns.every(c=>c.label));assert.ok(sheet.rows.every(r=>r.length===sheet.columns.length));assert.ok(sheet.rows.flat().every(v=>v===null||typeof v==='string'||typeof v==='number'&&Number.isFinite(v)));}
 }
});
test('unknown facts remain distinct from zero and structural blanks, with no synthetic enrichment of custom records',()=>{
 const r={...base[0],financial:0,coverage:0};const sheet=report('uao-vga',defaultFilters(),[r]);
 assert.equal(cell(sheet,0,'V'),0);assert.equal(cell(sheet,0,'R'),0);assert.equal(cell(sheet,0,'A'),null);
 assert.equal(cell(sheet,0,'GW'),missing);assert.equal(cell(sheet,0,'HA'),missing);assert.equal(cell(sheet,0,'HY'),missing);
});
test('record groups never multiply amounts through one-to-many child joins or repeated source identities',()=>{
 const subset=base.slice(0,4),sheet=report('uao-org',defaultFilters(),[...subset,...subset]);
 assert.equal(sheet.rows.reduce((n,r)=>n+r[sheet.columns.findIndex(c=>c.id==='J')],0),subset.reduce((n,r)=>n+r.financial,0));
 assert.equal(generateArchiveReport('uao-org',defaultFilters(),[...subset,...subset]).recordCount,4);
 assert.throws(()=>generateArchiveReport('uao-org',defaultFilters(),[subset[0],{...subset[0],financial:100}]),/Противоречивые/);
});
test('four directions reconcile exactly to total due and total execution, cancellation never exceeds residual',()=>{
 const sheet=report('uao-vga');for(let i=0;i<sheet.rows.length;i++){
  assert.equal(['GW','GX','GY','GZ'].reduce((n,c)=>n+cell(sheet,i,c),0),cell(sheet,i,'GV'));
  assert.equal(['HB','HC','HD','HE'].reduce((n,c)=>n+cell(sheet,i,c),0),cell(sheet,i,'HA'));
  assert.ok(cell(sheet,i,'HA')+cell(sheet,i,'HF')<=cell(sheet,i,'GV'));
 }
 assert.equal(sheet.rows.reduce((n,_,i)=>n+cell(sheet,i,'V'),0),base.reduce((n,r)=>n+r.financial,0));
});
test('execution and cancellation events are linked by violation and excluded until confirmation date',()=>{
 const event=archiveDemoFacts.executions[0],r=base.find(r=>r.id===event.caseId);
 const early=report('uao-residuals',{...defaultFilters(),to:r.date});const er=find(early,r.id);
 assert.equal(cell(early,er,'L')+cell(early,er,'M')+cell(early,er,'N'),0);
 const later=report('uao-residuals',{...defaultFilters(),to:event.confirmedAt});const lr=find(later,r.id);
 assert.ok(cell(later,lr,'L')+cell(later,lr,'M')+cell(later,lr,'N')>0);
});
test('balance is as-of, includes cases before period start and subtracts cancellation separately',()=>{
 const filters={...defaultFilters(),from:'2026-09-01'},result=generateArchiveReport('uao-residuals',filters),sheet=result.sheets[0];
 assert.equal(result.recordCount,24);assert.ok(generateArchiveReport('uao-vga',filters).recordCount<24);
 for(let i=0;i<sheet.rows.length;i++)for(const [due,exec,cancel,balance]of [['I','L','R','O'],['J','M','S','P'],['K','N','T','Q']])assert.equal(cell(sheet,i,balance),cell(sheet,i,due)-cell(sheet,i,exec)-cell(sheet,i,cancel));
 const history=report('uao-residuals-years');for(const letter of ['N','O','P','W','X','Y'])assert.ok(history.rows.every((_,i)=>cell(history,i,letter)===missing));
});
test('date, organ, text, format and amount filters are inclusive; EGA always restricts to electronic cases',()=>{
 const r=base[1],filters={...defaultFilters(),from:r.date,to:r.date,organ:r.organ,query:r.id,minFinancial:String(r.financial)};
 const result=generateArchiveReport('uao-vga',filters);assert.equal(result.recordCount,1);assert.equal(cell(result.sheets[0],0,'C'),r.id);
 const ega=generateArchiveReport('uao-ega',{...defaultFilters(),format:'Бумажный'});assert.equal(ega.config.filters.format,'Электронный');assert.equal(ega.recordCount,base.filter(r=>r.format==='Электронный').length);
 assert.equal(generateArchiveReport('uao-vga',{...defaultFilters(),from:'2025-01-01',to:'2025-12-31'}).recordCount,0);
});
test('invalid filters fail before generation',()=>{
 for(const change of [{from:'2026-02-30'},{from:'2026-10-01',to:'2026-01-01'},{minFinancial:-1},{minFinancial:'oops'},{onlyOverdue:'true'},{query:123},{risk:'Высокий'},{unknown:'x'}])assert.ok(validateArchiveFilters({...defaultFilters(),...change}));
 assert.throws(()=>generateArchiveReport('uao-vga',{...defaultFilters(),to:'2026-99-01'}));
});
test('SocEconom converts thousands to millions and never supplies VGA facts to another direction or prior year',()=>{
 const sheet=report('uao-social'),schema=archiveForms.find(f=>f.id==='uao-social').sheets[0];
 const row=source=>schema.rows.findIndex(r=>r.sourceRow===source);
 assert.equal(cell(sheet,row(8),'F'),base.reduce((n,r)=>n+r.coverage,0)/1000);
 assert.equal(cell(sheet,row(9),'F'),base.reduce((n,r)=>n+r.financial,0)/1000);
 assert.equal(cell(sheet,row(9),'G'),missing);assert.equal(cell(sheet,row(9),'H'),missing);assert.equal(cell(sheet,row(9),'I'),missing);
 for(const sourceRow of [32,33,42,48,61])assert.equal(cell(sheet,row(sourceRow),'F'),missing);
});
test('rating keeps static rules, leaves scores and rank unknown, and supplies only supported underlying facts',()=>{
 const result=generateArchiveReport('uao-rating-criteria');
 for(const sheet of result.sheets.slice(1,3))for(const row of sheet.rows)assert.ok(row.slice(4).every(v=>v===null||v===missing));
 const summary=result.sheets[3];assert.equal(cell(summary,0,'A'),1);assert.ok(cell(summary,0,'B').startsWith('ДВГА'));assert.equal(cell(summary,0,'C'),missing);
 const indicators=result.sheets[0],schema=archiveForms.find(f=>f.id==='uao-rating-criteria').sheets[0];const countRow=schema.rows.findIndex(r=>r.sourceRow===11);const akmola=indicators.columns.find(c=>c.label==='Акмолинская область');
 assert.equal(cell(indicators,countRow,akmola.id),base.filter(r=>r.region==='Акмолинская область').length);
});
test('plans, desk-control data, judicial amounts and unclassified budget principles never reuse general totals',()=>{
 const vga=report('uao-vga');for(const c of ['W','X','HY','IC','ID'])assert.ok(vga.rows.every((_,i)=>cell(vga,i,c)===missing));
 const principles=report('uao-budget-principles');assert.ok(principles.rows.every(r=>r.slice(2).every(v=>v===missing)));
 for(const id of ['uao-procurement','uao-operplan','uao-operplan-orders','uao-operplan-violations'])assert.throws(()=>generateArchiveReport(id),/Неизвестная архивная форма/);
});
test('coverage explicitly separates existing demo fields, new illustrative fixtures and unavailable sources',()=>{
 const coverage=archiveCoverage(),vga=coverage.find(f=>f.id==='uao-vga').sheets[0].columns;
 assert.equal(vga.find(c=>c.letter==='V').provenance,'existing-demo-record');assert.equal(vga.find(c=>c.letter==='GW').provenance,'demo-fixture');assert.equal(vga.find(c=>c.letter==='HY').provenance,'unavailable');
});

test('residual yearly execution/cancellation columns are period movements while closing balance is cumulative',()=>{
 const event=archiveDemoFacts.executions.find(e=>e.measure==='reimburse'),r=base.find(r=>r.id===event.caseId);
 const sheet=report('uao-residuals-years',{...defaultFilters(),from:'2026-09-01'}),index=find(sheet,r.id);
 assert.equal(cell(sheet,index,'E'),0);assert.equal(cell(sheet,index,'F'),0);
 const all=report('uao-residuals-years'),allIndex=find(all,r.id);assert.ok(cell(all,allIndex,'E')>0);assert.equal(cell(sheet,index,'G'),cell(all,allIndex,'G'));
});
test('republican institution totals require explicit funding level and object type, rather than inferring either from coverage',()=>{
 const custom={...base[1],budgetLevel:'Республиканский бюджет'};const sheet=report('uao-budget-execution',defaultFilters(),[custom]);
 assert.equal(cell(sheet,0,'B'),1);assert.equal(cell(sheet,0,'C'),missing);assert.equal(cell(sheet,0,'D'),missing);assert.equal(cell(sheet,0,'E'),missing);
});
