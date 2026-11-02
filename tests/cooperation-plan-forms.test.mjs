import test from 'node:test';
import assert from 'node:assert/strict';
import {archiveForms, formDepartment} from '../form-registry.js';
import {generateArchiveReport} from '../archive-engine.js';
import {exportArchiveXlsx} from '../export.js';
import {defaultFilters} from '../data.js';

const detail = 'cooperation-plan-detail', monitoring = 'cooperation-plan-monitoring';
const missing = 'Нет данных';
const fixture = (id, category = 'МИО', institutionId = 'mio-01', plan = {}, rest = {}) => ({
 id, module:'СВА', date:'2030-12-31', region:'Акмолинская область', organ:'СВА учебного учреждения',
 object:`Учебный объект ${id}`, bin:'000000000001', status:'В работе', reportIncluded:'Да',
 kind:'Соответствие', auditType:'Плановый', format:'Электронный',
 financial:2500, procedural:500, auditor:'Учебный аудитор', auditorPosition:'Главный специалист',
 cooperation:{category, institutionId},
 plan:{year:2026, quarter:1, assignedAt:'2026-01-10', completedAt:null, excludedAt:null,
  coverage:12000, kind:'Соответствие', event:`Учебное мероприятие ${id}`,
  orderNumber:`ПР-${id}`, legacyCaseNumber:`ДЕЛО-${id}`, ...plan},
 ...rest,
});
const generate = (id, source, filters = {}) => generateArchiveReport(id, {...defaultFilters(), ...filters}, source);
const cells = (report, name = 'лист') => report.sheets.find(sheet => sheet.name === name).templateLayout.cells;
const decode = value => value.replace(/&(amp|lt|gt|quot|apos);/g, (_, key) => ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[key]));
const attr = (value, key, fallback = '') => value.match(new RegExp(`\\b${key}="([^"]*)"`))?.[1] ?? fallback;
function unzip(bytes) {
 const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), decoder = new TextDecoder(), files = {};
 for (let offset = 0; offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50;) {
  assert.equal(view.getUint16(offset + 8, true), 0);
  const size = view.getUint32(offset + 18, true), name = view.getUint16(offset + 26, true), extra = view.getUint16(offset + 28, true);
  const start = offset + 30 + name + extra;
  files[decoder.decode(bytes.slice(offset + 30, offset + 30 + name))] = decoder.decode(bytes.slice(start, start + size));
  offset = start + size;
 }
 return files;
}

test('new cooperation forms retain the two source workbooks and existing VGA forms', () => {
 const a = archiveForms.find(form => form.id === detail), b = archiveForms.find(form => form.id === monitoring);
 assert.equal(formDepartment(a), 'audit-cooperation'); assert.equal(formDepartment(b), 'audit-cooperation');
 assert.deepEqual(a.sources, ['СВА']); assert.deepEqual(b.sources, ['СВА']);
 assert.deepEqual(a.sheets.map(s => [s.name, s.columnCount, s.templateLayout.rowCount]), [['СВА ЦГО',14,13],['СВА МИО',14,13]]);
 assert.deepEqual(b.sheets.map(s => [s.name, s.columnCount, s.templateLayout.rowCount]), [['лист',28,89]]);
 assert.equal(b.sheets[0].dataRows.length, 64);
 assert.deepEqual(b.sheets[0].totalRows.map(row => row.sourceRow), [42,63,78,79]);
 for (const old of ['received-plan-detail','received-plan-monitoring'])
  assert.equal(formDepartment(archiveForms.find(form => form.id === old)), 'digital-risks');
});

test('institution IDs put each plan on its own source row rather than copying category totals', () => {
 const source = [fixture('water','ЦГО','cgo-03'), fixture('foreign','ЦГО','cgo-02'), fixture('foreign2','ЦГО','cgo-02'),
  fixture('astana','МИО','mio-15'), fixture('almaty','МИО','mio-16'), fixture('vko','ДП','dp-09')];
 const output = cells(generate(monitoring, source));
 assert.equal(output.D13,1); assert.equal(output.D14,2); assert.equal(output.D42,3);
 assert.equal(output.D57,1); assert.equal(output.D58,1); assert.equal(output.D63,2);
 assert.equal(output.D65,1); assert.equal(output.D78,1); assert.equal(output.D79,6);
 assert.equal(output.D12,undefined); assert.equal(output.D43,undefined);
});

test('quarterly plan and cumulative events use cutoff date even when audit report dates are outside it', () => {
 const source = [
  fixture('q1-done','МИО','mio-01',{quarter:1,completedAt:'2026-03-31'}),
  fixture('q2-done','МИО','mio-01',{quarter:2,assignedAt:'2026-04-01',completedAt:'2026-06-30'}),
  fixture('q3-open','МИО','mio-01',{quarter:3,assignedAt:null}),
  fixture('q3-edge','МИО','mio-01',{quarter:3,assignedAt:'2026-09-30',completedAt:'2026-10-01'}),
  fixture('q4-future','МИО','mio-01',{quarter:4,assignedAt:'2026-10-01'}),
 ];
 const report = generate(monitoring, source, {from:'2026-07-01',to:'2026-09-30'}), output = cells(report);
 assert.equal(report.recordCount,5);
 assert.deepEqual(['E','F','G','H'].map(c => output[c+'43']), [1,1,1,0]);
 assert.deepEqual(['I','J','K','L'].map(c => output[c+'43']), [1,1,1,0]);
 assert.deepEqual(['M','N','O','P','Q'].map(c => output[c+'43']), [2,1,1,0,2]);
 assert.deepEqual(['R','S','T','U'].map(c => output[c+'43']), [1,0,0,1]);
 assert.deepEqual(['D','V','W','X','Y','Z','AA','AB'].map(c => output[c+'43']), [5,5,3,60,2,40,3,60]);
});

test('the plan year comes from cutoff and excluded positions disappear only on their exclusion date', () => {
 const source = [fixture('previous','МИО','mio-01',{year:2025}),fixture('next','МИО','mio-01',{year:2027}),
  fixture('exclude-now','МИО','mio-01',{excludedAt:'2026-09-30',exclusionReason:'Учебная корректировка'}),
  fixture('exclude-later','МИО','mio-01',{excludedAt:'2026-10-01'})];
 const before = generate(monitoring, source, {to:'2026-09-29'}), at = generate(monitoring, source);
 assert.equal(before.recordCount,2); assert.equal(cells(before).D43,2);
 assert.equal(at.recordCount,1); assert.equal(cells(at).D43,1);
 const rows = generate(detail, source); assert.equal(rows.recordCount,2);
 assert.match(cells(rows,'СВА МИО').I9,/Исключен 2026-09-30/);
 const next = generate(monitoring,source,{from:'2027-01-01',to:'2027-01-31'});
 assert.equal(next.recordCount,1); assert.equal(cells(next).D43,1);
 assert.match(cells(next).B4,/2027/); assert.match(cells(next).D8,/2027/);
});

test('detail divides thousands into millions, separates CGO/MIO and omits DP', () => {
 const source = [fixture('cgo','ЦГО','cgo-01',{completedAt:'2026-09-30'}),
  fixture('mio','МИО','mio-01',{completedAt:'2026-10-01'}),fixture('dp','ДП','dp-01')];
 const report = generate(detail,source), cgo = cells(report,'СВА ЦГО'), mio = cells(report,'СВА МИО');
 assert.equal(report.recordCount,2); assert.deepEqual(report.sheets.map(s => s.name),['СВА ЦГО','СВА МИО']);
 assert.equal(cgo.B9,'Учебный объект cgo'); assert.equal(mio.B9,'Учебный объект mio');
 assert.equal(cgo.H9,'ДЕЛО-cgo'); assert.equal(cgo.N9,'Учебный аудитор, Главный специалист');
 assert.equal(cgo.F9,1); assert.equal(cgo.G9,3);
 assert.deepEqual(['J','K','L','M'].map(c => cgo[c+'9']),[12,3,2.5,.5]);
 assert.equal(mio.K9,missing); assert.equal(mio.G9,missing);
 assert.equal(mio.J9,12); assert.equal(cgo.K12,3);
});

test('detail adds only necessary data rows and moves its original total for longer lists', () => {
 const source = Array.from({length:5},(_,index) => fixture(`more-${index}`,'МИО','mio-01',{completedAt:'2026-06-30'}));
 const report = generate(detail,source), sheet = report.sheets[1], output = cells(report,'СВА МИО');
 assert.equal(sheet.templateLayout.rowCount,15);
 assert.equal(output.B13,'Учебный объект more-4'); assert.equal(output.B14,'Итого ');
 assert.equal(output.J14,60); assert.equal(output.K14,15);
 assert.equal(report.sheets[0].templateLayout.rowCount,13);
});

test('unknown facts remain unavailable while explicit no-event facts yield known zero', () => {
 const known = fixture('known','МИО','mio-01',{assignedAt:null,completedAt:null});
 const unknown = fixture('unknown','МИО','mio-02',{assignedAt:undefined,completedAt:undefined});
 const report = generate(monitoring,[known,unknown]), output = cells(report);
 assert.equal(output.D43,1); assert.equal(output.W43,0); assert.equal(output.Y43,0);
 assert.equal(output.D44,1); assert.equal(output.W44,missing); assert.equal(output.Y44,missing);
 assert.equal(output.D63,2); assert.equal(output.W63,missing); assert.equal(output.Y63,missing);
 const noPlan = fixture('no-plan','МИО','mio-01',{}, {plan:undefined});
 assert.equal(cells(generate(monitoring,[noPlan])).D43,missing);
 const noAmounts = fixture('unknown-amounts','МИО','mio-01',{coverage:undefined,completedAt:'2026-06-30'},{financial:null});
 const body = cells(generate(detail,[noAmounts]),'СВА МИО');
 assert.equal(body.J9,missing); assert.equal(body.K9,missing); assert.equal(body.M9,.5);
});

test('common filters restrict plans without substituting synthetic facts', () => {
 const a = fixture('a','МИО','mio-01',{}, {region:'Атырауская область',organ:'Первый орган',status:'В работе',object:'Нужный объект'});
 const b = fixture('b','МИО','mio-02',{}, {region:'Акмолинская область',organ:'Второй орган',status:'Завершено',format:'Бумажный'});
 for (const filter of [{region:'Атырауская область'},{organ:'Первый орган'},{status:'В работе'},{format:'Электронный'},{query:'Нужный объект'}]) {
  const report = generate(monitoring,[a,b],filter);
  assert.equal(report.recordCount,1); assert.equal(cells(report).D43,1); assert.equal(cells(report).D44,undefined);
 }
 assert.equal(generate(monitoring,[{...a,module:'ВГА'}]).recordCount,0);
});

test('identical duplicates count once; conflicting versions, invalid dates and reverse events fail clearly', () => {
 const row = fixture('same');
 assert.equal(cells(generate(monitoring,[row,structuredClone(row)])).D43,1);
 assert.throws(() => generate(monitoring,[row,{...row,financial:99}]),/Противоречивые/);
 for (const plan of [{assignedAt:'2026-02-30'},{completedAt:'2026-01-01'},{assignedAt:null,completedAt:'2026-01-20'}])
  assert.throws(() => generate(monitoring,[fixture('bad','МИО','mio-01',plan)]),/дата|предшествовать/);
});

test('DP institutions missing from the fourteen-row source are rejected rather than silently dropped', () => {
 const row = fixture('unlisted','ДП','dp-02');
 assert.throws(() => generate(monitoring,[row]),/отсутствует среди подразделений/);
 assert.equal(generate(detail,[row]).recordCount,0);
 const wrongCategory = fixture('wrong','МИО','cgo-01');
 assert.throws(() => generate(monitoring,[wrongCategory]),/отсутствует среди подразделений/);
});

test('demo Astana, Almaty and Turkestan records reach their actual MIO rows', () => {
 for (const [region,row] of [['г. Астана',57],['г. Алматы',58],['Туркестанская область',56]]) {
  const report = generateArchiveReport(monitoring,{...defaultFilters(),region});
  assert.ok(report.recordCount>0); const output = cells(report);
  assert.equal(output[`D${row}`],report.recordCount);
  for (let r=43;r<=62;r++) if(r!==row) assert.equal(output[`D${r}`],undefined);
 }
});

test('actual XLSX has exactly source sheets, TNR for every cell font, no frozen panes or extra service tabs', () => {
 for (const [id,names,dimensions] of [[detail,['СВА ЦГО','СВА МИО'],['A1:N13','A1:N13']],[monitoring,['лист'],['A1:AB89']]]) {
  const files = unzip(exportArchiveXlsx(generate(id,[])));
  const actualNames = [...files['xl/workbook.xml'].matchAll(/<sheet\b([^>]*)\/?\s*>/g)].map(match=>decode(attr(match[1],'name')));
  assert.deepEqual(actualNames,names);
  const fonts=[...files['xl/styles.xml'].match(/<fonts\b[^>]*>([\s\S]*?)<\/fonts>/)[1].matchAll(/<name\b[^>]*val="([^"]+)"/g)].map(m=>m[1]);
  assert.ok(fonts.length); assert.ok(fonts.every(font=>font==='Times New Roman'));
  names.forEach((name,index)=>{
   const xml=files[`xl/worksheets/sheet${index+1}.xml`];
   assert.match(xml,new RegExp(`<dimension ref="${dimensions[index]}"`));
   assert.doesNotMatch(xml,/<pane\b|<f(?:\s|>)|NaN|Infinity|#REF!|#DIV\/0!/);
  });
 }
});
