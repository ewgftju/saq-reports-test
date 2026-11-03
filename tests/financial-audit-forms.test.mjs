import test from 'node:test';
import assert from 'node:assert/strict';
import {archiveForms,formDepartment} from '../form-registry.js';
import {generateArchiveReport} from '../archive-engine.js';
import {exportArchiveXlsx} from '../export.js';
import {defaultFilters} from '../data.js';

const prefix='financial-audit-', missing='Нет данных';
const parent=(id,financialAudit={},overrides={})=>({id,module:'ВГА',date:'2030-12-31',
 region:'г. Астана',organ:'ДВГА по г. Астана',object:`Учебный объект ${id}`,bin:'000000000001',
 status:'Завершено',kind:'Финансовая отчетность',format:'Электронный',reportIncluded:'Да',
 auditor:'Не использовать вместо отправителя',financial:999999,procedural:888888,
 financialAudit,...overrides});
const approval=(id,overrides={})=>({id,sentAt:'2026-06-01',sender:'Учебный отправитель',documentLinks:['https://example.test/evidence'],...overrides});
const result=(id,overrides={})=>({id,date:'2026-06-01',balanceStart:1000,balanceEnd:1200,totalViolations:150,
 distortingAmount:100,distortingCount:2,nonDistortingAmount:50,nonDistortingCount:1,reviewer:'Учебный проверяющий',...overrides});
const transfer=(id,overrides={})=>({id,transferredAt:'2026-04-01',factId:`fact-${id}`,amount:100,statusEvents:[],...overrides});
const stage=(id,status,date='2026-04-02')=>({id,status,date});
const admin=(id,overrides={})=>({id,person:'Учебное лицо',basis:'ДВГА',article:'Учебная статья',reviewingBody:'ДВГА',
 decision:'наложено',decisionAt:'2026-06-01',fine:1000,collections:[],enforcementSentAt:null,appeals:[],...overrides});
const payment=(id,amount,kind='voluntary',date='2026-06-02')=>({id,amount,kind,date});
const appeal=(id,overrides={})=>({id,date:'2026-06-05',body:'Суд',result:'отказ',resultAt:'2026-06-15',...overrides});
const generate=(name,source,filters={})=>generateArchiveReport(prefix+name,{...defaultFilters(),...filters},source);
const cells=report=>report.sheets[0].templateLayout.cells;
const numberRow=(output,letters,row)=>letters.map(letter=>output[`${letter}${row}`]);
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

test('four financial forms preserve the source sheets and meaningful fields',()=>{
 for(const [name,sheet,width,height]of [['approvals','Лист1',9,10],['results','Лист1',13,3],['transfers','Лист1',13,51],['administrative','Еженедельная сводка',13,21]]){
  const form=archiveForms.find(f=>f.id===prefix+name);assert.ok(form);
  assert.equal(formDepartment(form),'financial-audit');assert.deepEqual(form.sources,['ВГА']);
  assert.deepEqual(form.sheets.map(s=>[s.name,s.columnCount,s.templateLayout.rowCount]),[[sheet,width,height]]);
 }
 const source=archiveForms.find(f=>f.id===prefix+'transfers').sheets[0];
 assert.equal(source.dataRows.length,21);assert.equal(source.dataRows.at(-1).label,'КВГА');
 assert.equal(source.totalRows[0].sourceRow,24);
});

test('approval events at both period boundaries are included and repeats are separate sends',()=>{
 const source=[parent('p',{approvals:[approval('old',{sentAt:'2026-03-31'}),approval('start',{sentAt:'2026-04-01'}),
  approval('end',{sentAt:'2026-06-30'}),approval('future',{sentAt:'2026-07-01'})]})];
 const report=generate('approvals',source,{from:'2026-04-01',to:'2026-06-30'}),output=cells(report);
 assert.equal(report.recordCount,2);assert.equal(report.objectCount,1);
 assert.equal(output.H3,'01.04.2026');assert.equal(output.H4,'30.06.2026');
 assert.equal(output.G3,'Учебный отправитель');assert.equal(output.I3,'https://example.test/evidence');
 assert.equal(output.C3,2026);assert.equal(output.A3,undefined);
});

test('approval sender and evidence are not borrowed from parent auditor when missing',()=>{
 const output=cells(generate('approvals',[parent('p',{approvals:[approval('a',{sender:undefined,documentLinks:undefined})]})]));
 assert.equal(output.G3,missing);assert.equal(output.I3,missing);
 assert.equal(generate('approvals',[parent('without-container')]).recordCount,0);
});

test('financial balances and distortion amounts use explicit form facts in thousands',()=>{
 const source=[parent('p',{results:[result('r',{year:2025})]},{kind:'Соответствие'})];
 const report=generate('results',source),output=cells(report);
 assert.equal(report.recordCount,1);assert.equal(output.C3,2025);
 assert.deepEqual(numberRow(output,['F','G','H','I','J','K','L'],3),[1000,1200,150,100,2,50,1]);
 assert.equal(output.M3,'Учебный проверяющий');
 const unknown=cells(generate('results',[parent('p',{results:[result('r',{totalViolations:undefined,balanceStart:null,reviewer:undefined})]})]));
 assert.equal(unknown.F3,missing);assert.equal(unknown.H3,missing);assert.equal(unknown.M3,missing);
});

test('each report filters its own event date and preserves other parent filters',()=>{
 const fields={approvals:['sentAt',approval],results:['date',result],transfers:['transferredAt',transfer],administrative:['decisionAt',admin]};
 for(const [name,[dateKey,make]]of Object.entries(fields)){
  const source=[parent('yes',{[name]:[make('yes-event',{[dateKey]:'2027-01-01'})]},{region:'Атырауская область'}),
   parent('no',{[name]:[make('no-event',{[dateKey]:'2027-01-01'})]},{region:'г. Алматы'}),
   parent('old',{[name]:[make('old-event',{[dateKey]:'2026-12-31'})]},{region:'Атырауская область'})];
  const report=generate(name,source,{from:'2027-01-01',to:'2027-01-31',region:'Атырауская область'});
  assert.equal(report.recordCount,1,name);
  assert.equal(generate(name,source,{from:'2027-01-01',to:'2027-01-31',query:'Учебный объект no'}).recordCount,1,name);
 }
});

test('transfer counts and fact amounts remain distinct and totals include the KVGA row',()=>{
 const statuses=['возбуждено','приобщено к ердр','отказано в возбуждении','направлено в другие органы','списано в спецнаряд','на рассмотрении','прекращено','направлено в суд','в производстве'];
 const first=transfer('t1',{factId:'shared',statusEvents:[stage('s1','возбуждено'),stage('s1','возбуждено'),stage('s2','направлено в суд','2026-04-03')]}),
  second=transfer('t2',{factId:'shared',statusEvents:[stage('s3','в производстве')]}),
  third=transfer('t3',{factId:'shared',statusEvents:[stage('s4','на рассмотрении')]});
 const source=[parent('p1',{transfers:[first,structuredClone(first),second]}),parent('p2',{transfers:[third]}),
  parent('central',{transfers:statuses.map((status,i)=>transfer(`central-${i}`,{amount:10,statusEvents:[stage(`cs${i}`,status)]}))},{organ:'КВГА'})];
 const report=generate('transfers',source),output=exported(report).cells;
 assert.equal(report.recordCount,12);assert.equal(output.C3,3);assert.equal(output.M3,100);
 assert.equal(output.C23,9);assert.deepEqual(numberRow(output,['D','E','F','G','H','I','J','K','L'],23),Array(9).fill(1));
 assert.equal(output.C24,12);assert.equal(output.M24,190);
 assert.deepEqual(numberRow(output,['D','E','F','G','H','I','J','K','L'],24),[2,1,1,1,1,2,1,2,2]);
});

test('transfer state snapshots replace obsolete stages at cutoff while retaining both outcome groups',()=>{
 const source=[parent('p',{transfers:[transfer('t',{statusEvents:[stage('review','на рассмотрении','2026-04-02'),
  stage('opened','возбуждено','2026-04-05'),stage('process','в производстве','2026-04-06'),
  stage('court','направлено в суд','2026-04-10'),stage('closed','прекращено','2026-10-01')]})]})];
 const early=cells(generate('transfers',source,{to:'2026-04-03'}));
 assert.equal(early.I3,1);assert.equal(early.D3,0);
 const after=cells(generate('transfers',source));
 assert.equal(after.I3,0);assert.equal(after.D3,1);assert.equal(after.K3,1);assert.equal(after.L3,0);assert.equal(after.J3,0);
 const final=cells(generate('transfers',source,{to:'2026-10-01'}));
 assert.equal(final.D3,1);assert.equal(final.J3,1);assert.equal(final.K3,0);
});

test('missing fact identifiers propagate unknown amounts and contradictory reuse fails',()=>{
 const noId=transfer('unknown',{factId:undefined}),known=transfer('known',{amount:40});
 const output=cells(generate('transfers',[parent('p',{transfers:[known,noId]})]));
 assert.equal(output.C3,2);assert.equal(output.M3,missing);assert.equal(output.M24,missing);
 const first=transfer('one',{factId:'fact',amount:50});
 assert.throws(()=>generate('transfers',[parent('a',{transfers:[first]}),parent('b',{transfers:[transfer('two',{factId:'fact',amount:50})]},{region:'г. Алматы'})]),/Противоречив/);
 assert.throws(()=>generate('transfers',[parent('a',{transfers:[first,transfer('two',{factId:'fact',amount:51})]})]),/Противоречив/);
});

test('Kazakh regional labels and central organ match their separate source rows',()=>{
 const source=[parent('t',{transfers:[transfer('t')]},{region:'Түркістан'}),
  parent('q',{transfers:[transfer('q')]},{region:'Қызылорда'}),
  parent('c',{transfers:[transfer('c')]},{organ:'ЦА',region:'г. Астана'})];
 const output=cells(generate('transfers',source));
 assert.equal(output.C7,1);assert.equal(output.C8,1);assert.equal(output.C23,1);assert.equal(output.C3,undefined);
 assert.throws(()=>generate('transfers',[parent('unmapped',{transfers:[transfer('u')]},{region:'Неизвестный регион'})]),/отсутствует среди строк/);
});

test('administrative collections add voluntary and enforced amounts once and sum only monetary totals',()=>{
 const paid=payment('vol',200),forced=payment('forced',300,'enforced');
 const source=[parent('p',{administrative:[admin('a',{collections:[paid,structuredClone(paid),forced],enforcementSentAt:'2026-06-02'}),
  admin('b',{fine:400,collections:[payment('b-pay',100)]})]})];
 const report=generate('administrative',source),output=exported(report).cells;
 assert.deepEqual(numberRow(output,['H','I','K'],5),[1000,500,300]);
 assert.deepEqual(numberRow(output,['H','I','K'],10),[1400,600,300]);
 assert.equal(output.G5,'01.06.2026');assert.equal(output.J5,'02.06.2026');
 for(const column of ['G','J','L','M'])assert.equal(output[column+'10'],undefined);
});

test('administrative cutoff excludes future payments, enforcement and appeal results',()=>{
 const source=[parent('p',{administrative:[admin('a',{
  collections:[payment('early',200,'voluntary','2026-06-02'),payment('late',300,'enforced','2026-10-01')],
  enforcementSentAt:'2026-10-01',appeals:[appeal('appeal',{resultAt:'2026-10-01'}),appeal('future',{date:'2026-10-02',resultAt:null})]
 })]})];
 const before=cells(generate('administrative',source)),at=cells(generate('administrative',source,{to:'2026-10-01'}));
 assert.equal(before.I5,200);assert.equal(before.K5,0);assert.equal(before.J5,'—');assert.equal(before.L5,'Суд');assert.equal(before.M5,missing);
 assert.equal(at.I5,500);assert.equal(at.K5,300);assert.equal(at.J5,'01.10.2026');assert.equal(at.M5,'отказ');
});

test('explicit empty collections produce zero while absent facts and amounts remain unavailable',()=>{
 const output=cells(generate('administrative',[parent('p',{administrative:[admin('known'),admin('unknown',{fine:undefined,collections:undefined,appeals:undefined,enforcementSentAt:undefined})]})]));
 assert.equal(output.I5,0);assert.equal(output.K5,0);assert.equal(output.L5,'—');
 assert.equal(output.H6,missing);assert.equal(output.I6,missing);assert.equal(output.K6,missing);assert.equal(output.L6,missing);assert.equal(output.J6,missing);
 assert.equal(output.H10,missing);assert.equal(output.I10,missing);assert.equal(output.K10,missing);
 const transferOutput=cells(generate('transfers',[parent('p',{transfers:[transfer('u',{statusEvents:undefined})]})]));
 assert.equal(transferOutput.C3,1);assert.equal(transferOutput.D3,missing);assert.equal(transferOutput.M3,100);
});

test('duplicates are counted once and conflicting parent or event versions fail',()=>{
 const send=approval('same'),p=parent('p',{approvals:[send,structuredClone(send)]});
 assert.equal(generate('approvals',[p,structuredClone(p)]).recordCount,1);
 assert.throws(()=>generate('approvals',[p,{...p,object:'Другой объект'}]),/Противоречив/);
 assert.throws(()=>generate('approvals',[parent('p',{approvals:[send,{...send,sender:'Другой отправитель'}]})]),/Противоречив/);
 assert.throws(()=>generate('approvals',[parent('a',{approvals:[send]}),parent('b',{approvals:[structuredClone(send)]})]),/несколькими/);
});

test('nested payment, appeal and stage IDs cannot belong to multiple parent events',()=>{
 const pay=payment('shared-pay',100),ap=appeal('shared-appeal'),st=stage('shared-stage','возбуждено');
 assert.throws(()=>generate('administrative',[parent('a',{administrative:[admin('a',{collections:[pay]})]}),parent('b',{administrative:[admin('b',{collections:[structuredClone(pay)]})]})]),/несколькими|переиспольз|принадлеж|связан|Противоречив/);
 assert.throws(()=>generate('administrative',[parent('a',{administrative:[admin('a',{appeals:[ap]}),admin('b',{appeals:[structuredClone(ap)]})]})]),/несколькими|переиспольз|принадлеж|связан|Противоречив/);
 assert.throws(()=>generate('transfers',[parent('a',{transfers:[transfer('a',{statusEvents:[st]}),transfer('b',{statusEvents:[structuredClone(st)]})]})]),/несколькими|переиспольз|принадлеж|связан|Противоречив/);
});

test('invalid dates and impossible payment or status chronology cannot be reported',()=>{
 assert.throws(()=>generate('approvals',[parent('p',{approvals:[approval('a',{sentAt:'2026-02-30'})]})]),/дата/);
 assert.throws(()=>generate('administrative',[parent('p',{administrative:[admin('a',{collections:[payment('p',100,'voluntary','2026-05-31')]})]})]),/предшествует/);
 assert.throws(()=>generate('administrative',[parent('p',{administrative:[admin('a',{fine:99,collections:[payment('p',100)]})]})]),/превышает/);
 assert.throws(()=>generate('administrative',[parent('p',{administrative:[admin('a',{collections:[payment('p',-1)]})]})]),/отрицатель/);
 assert.throws(()=>generate('transfers',[parent('p',{transfers:[transfer('t',{statusEvents:[stage('s','возбуждено','2026-03-31')]})]})]),/предшествует/);
 assert.throws(()=>generate('transfers',[parent('p',{transfers:[transfer('t',{statusEvents:[stage('s1','возбуждено'),stage('s2','отказано в возбуждении')]})]})]),/дат|поряд|Противоречив|одноврем/);
});

test('variable reports expand rows and move administrative totals and footer without new fields',()=>{
 const approvals=cells(generate('approvals',[parent('p',{approvals:Array.from({length:9},(_,i)=>approval(`a${i}`))})]));
 assert.equal(approvals.B11,9);assert.equal(approvals.H11,'01.06.2026');
 const resultReport=generate('results',[parent('p',{results:[result('r1'),result('r2')]})]);
 assert.equal(resultReport.sheets[0].templateLayout.rowCount,4);assert.equal(cells(resultReport).B4,2);
 const report=generate('administrative',[parent('p',{administrative:Array.from({length:6},(_,i)=>admin(`a${i}`,{fine:100,collections:[payment(`p${i}`,10)]}))})]);
 const output=exported(report).cells;
 assert.equal(report.sheets[0].templateLayout.rowCount,22);assert.equal(output.A10,6);assert.equal(output.A11,'ИТОГО');
 assert.equal(output.H11,600);assert.equal(output.I11,60);assert.equal(output.K11,0);
 assert.ok(report.sheets[0].templateLayout.merges.includes('A11:B11'));
});

test('real Excel exports have source sheets, TNR only, no panes, service tabs or formulas',()=>{
 for(const [name,data]of [['approvals',{approvals:[approval('a',{sender:'=USER()'})]}],['results',{results:[result('r')]}],
  ['transfers',{transfers:[transfer('t')]}],['administrative',{administrative:[admin('a')]}]]){
  const report=generate(name,[parent('p',data)]),book=exported(report);
  assert.deepEqual(book.names,[name==='administrative'?'Еженедельная сводка':'Лист1']);
  const fonts=[...book.files['xl/styles.xml'].match(/<fonts\b[^>]*>([\s\S]*?)<\/fonts>/)[1].matchAll(/<name\b[^>]*val="([^"]+)"/g)].map(m=>m[1]);
  assert.ok(fonts.length);assert.ok(fonts.every(font=>font==='Times New Roman'));
  assert.doesNotMatch(book.files['xl/worksheets/sheet1.xml'],/<pane\b|<f(?:\s|>)|NaN|Infinity|#REF!|#DIV\/0!/);
  assert.equal(report.sheets[0].templateLayout.columnCount,name==='approvals'?9:13);
  if(name==='approvals')assert.equal(book.cells.G3,'=USER()');
 }
});

test('missing custom events produce empty source bodies rather than demo values',()=>{
 for(const name of ['approvals','results','transfers','administrative']){
  const report=generate(name,[parent('custom')]);assert.equal(report.recordCount,0);
  const output=cells(report);
  if(name==='transfers')assert.equal(output.C3,undefined);
  else if(name==='administrative')assert.equal(output.B5,undefined);
  else assert.equal(output.D3,undefined);
  assert.equal(generate(name,[parent('other',{[name]:[]},{module:'СВА'})]).recordCount,0);
 }
});
