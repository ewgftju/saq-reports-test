import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {professionalForms, professionalReferenceSheets} from '../professional-schemas.js';
import {generateProfessionalReport, professionalReportDescriptions} from '../professional-engine.js';
import {records, defaultFilters} from '../data.js';
import {exportArchiveXlsx, archiveColumnOptions} from '../export.js';

const form = id => professionalForms.find(item => item.id === id);
const config = (id, filters = {}) => ({name: form(id).name, sources: ['ПРОФ'], filters: {...defaultFilters(), ...filters}, ...professionalReportDescriptions[id]});
const generate = (id, source, filters) => generateProfessionalReport(form(id), config(id, filters), source);
const base = (id, professional = {}, extra = {}) => ({id, module: 'ПРОФ', date: '2026-06-10', region: 'г. Астана', organ: 'ДВГА тест', object: 'Учебный субъект', bin: '000000000001', status: 'Завершено', financial: 1000, procedural: 100, procedureCount: 2, professional, ...extra});
function unzip(bytes) {
 const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), decode = new TextDecoder(), files = {};
 let offset = 0;
 while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
  const size = view.getUint32(offset + 18, true), nl = view.getUint16(offset + 26, true), el = view.getUint16(offset + 28, true), start = offset + 30 + nl + el;
  files[decode.decode(bytes.slice(offset + 30, offset + 30 + nl))] = decode.decode(bytes.slice(start, start + size)); offset = start + size;
 }
 return files;
}

test('six PK forms preserve template dimensions; the separate grounds reference is never appended', () => {
 assert.equal(professionalForms.length, 6);
 assert.deepEqual(professionalForms.map(item => item.catalogNumber), [20, 21, 12, 6, 1, 19]);
 assert.deepEqual(professionalForms.map(item => item.sheets[0].columnCount), [39, 22, 38, 46, 12, 9]);
 assert.equal(professionalReferenceSheets[0].entries.length, 22);
 assert.ok(professionalForms.every(item => item.sheets.length === 1));
 assert.equal(form('prof-public-interest').sheets[0].headerDepth, 5);
 assert.equal(form('prof-year-comparison').sheets[0].indicators.length, 17);
 const ao = form('prof-audit-organizations').sheets[0];
 for (let n = 1; n <= 17; n++) assert.ok(ao.columns.some(column => column.labels.includes(`Требование ${n}`)));
});

test('scope is explicit: AO, OPI and other modules never mix; custom IDs never acquire demo facts', () => {
 const source = [base('A', {scope: 'АО'}), base('B', {scope: 'ОПИ'}), base('C', {}), base('V', {scope: 'АО'}, {module: 'ВГА'})];
 const ao = generate('prof-audit-organizations', source), opi = generate('prof-public-interest', source);
 assert.equal(ao.recordCount, 1); assert.equal(opi.recordCount, 1);
 assert.equal(ao.sheets[0].rows[0][7], 'Нет данных');
 assert.equal(opi.sheets[0].rows[0][16], 'Нет данных');
 const defaultRecord = records.find(record => record.module === 'ПРОФ');
 const custom = generate('prof-public-interest', [{...defaultRecord, professional: {scope: 'ОПИ'}}]);
 assert.equal(custom.sheets[0].rows[0][10], 'Нет данных');
 assert.equal(custom.sheets[0].rows[0][15], defaultRecord.financial);
});

test('plan inclusion and special execution states never follow generic audit status', () => {
 const source = [base('A', {scope: 'АО', planIncluded: true, planState: 'license-revoked'}),
  base('B', {scope: 'АО', planIncluded: true}), base('C', {scope: 'ОПИ', planIncluded: false, planState: 'ceased'}),
  base('D', {scope: 'ОПИ', planState: 'ceased'})];
 const result = generate('prof-list-execution', source), row = result.sheets[0].rows[6];
 assert.equal(result.recordCount, 2); assert.equal(row[10], 2);
 assert.equal(row[11], 'Нет данных'); assert.equal(row[14], 'Нет данных');
 assert.equal(row[16], 0); assert.equal(row[20], 0);
 const known = generate('prof-list-execution', source.slice(0, 1)).sheets[0].rows[6];
 assert.equal(known[11], 0); assert.equal(known[14], 1);
});

test('EGOV keeps all bilingual fields and identifiers, without fabricating translations', () => {
 const source = [base('A', {scope: 'АО', planIncluded: true, subjectRu: 'Учебная организация', subjectKz: 'Оқу ұйымы', registrationDate: '2020-01-01', riskScore: 0})];
 const result = generate('prof-halfyear-list', source), row = result.sheets[0].rows[0];
 assert.equal(row.length, 39); assert.equal(row[4], 'Оқу ұйымы'); assert.equal(row[5], 'Учебная организация');
 assert.equal(row[6], '000000000001'); assert.equal(row[21], 0); assert.equal(row[22], 0);
 assert.equal(row[9], 'Нет данных');
 const headers = form('prof-halfyear-list').sheets[0].headerCells;
 assert.match(headers.B1, /Тексерілетін/); assert.match(headers.C1, /Дата государственной/);
});

test('region, organ, period and query filters change counts and totals consistently', () => {
 const all = generate('prof-public-interest'), sample = records.find(record => record.module === 'ПРОФ');
 const filtered = generate('prof-public-interest', undefined, {organ: sample.organ});
 assert.ok(filtered.recordCount < all.recordCount); assert.ok(filtered.recordCount > 0);
 const detail = filtered.sheets[0].rows.slice(0, -1), total = filtered.sheets[0].rows.at(-1);
 assert.equal(total[15], detail.reduce((n, row) => n + row[15], 0));
 assert.equal(generate('prof-public-interest', undefined, {query: 'definitely-no-match'}).recordCount, 0);
 assert.equal(generate('prof-public-interest', undefined, {from: '2027-01-01', to: '2027-12-31'}).recordCount, 0);
});

test('OPI totals sum quantitative fields only and preserve incomplete totals as missing', () => {
 const source = [base('A', {scope: 'ОПИ', notificationNumber: '001', orderNumber: '002', executedOrderCount: 1, orderCount: 2, dueBudget: 100}),
  base('B', {scope: 'ОПИ', orderCount: 1, executedOrderCount: 0}, {financial: 500})];
 const sheet = generate('prof-public-interest', source).sheets[0], total = sheet.rows.at(-1);
 assert.equal(total[15], 1500); assert.equal(total[16], 'Нет данных');
 assert.equal(total[43], 1); assert.equal(total[44], 2);
 for (const column of [1, 3, 8, 10, 11, 36, 37, 38, 39, 40, 41, 42]) assert.equal(total[column], null);
});

test('year comparison uses matched periods, converts thousands to millions and computes percent from baseline', () => {
 const p = {scope: 'ОПИ', orderCount: 1, executedOrderCount: 0, dueAccounting: 400, dueBudget: 300, dueEnterprise: 300, executedAccounting: 200, executedBudget: 100, executedEnterprise: 100, proceduralResolved: 50};
 const source = [base('2026', p, {financial: 2000}), base('2025', p, {date: '2025-06-10', financial: 1000}),
  base('OUT', p, {date: '2025-10-01', financial: 900000}), base('OTHER', p, {date: '2025-06-10', financial: 900000, organ: 'Другой орган'})];
 const result = generate('prof-year-comparison', source, {organ: 'ДВГА тест'}), rows = result.sheets[0].rows;
 assert.deepEqual(rows[5].slice(5), [2, 1, 1, 100]); // source row 8: financial
 assert.deepEqual(rows[0].slice(5), [1, 1, 0, 0]);
 assert.equal(rows[9][5], .4); // source row 12: restored components, not generic restored
 assert.match(result.sheets[0].headerCells.G1, /2025-01-01 — 2025-09-30/);
});

test('missing historical coverage and zero baseline remain distinct in year comparison', () => {
 const now = base('NOW', {scope: 'ОПИ'}, {financial: 2000});
 const absent = generate('prof-year-comparison', [now]).sheets[0].rows[5];
 assert.deepEqual(absent.slice(5), [2, 'Нет данных', 'Нет данных', 'Нет данных']);
 const zero = generate('prof-year-comparison', [now, base('PAST', {scope: 'ОПИ'}, {date: '2025-06-10', financial: 0})]).sheets[0].rows[5];
 assert.deepEqual(zero.slice(5), [2, 0, 2, 'Нет данных']);
 const unknownComponents = generate('prof-year-comparison', [now]).sheets[0].rows[9];
 assert.equal(unknownComponents[5], 'Нет данных');
});

test('duplicate identical IDs count once; conflicting records are rejected', () => {
 const record = base('A', {scope: 'ОПИ'});
 assert.equal(generate('prof-public-interest', [record, {...record}]).recordCount, 1);
 assert.throws(() => generate('prof-public-interest', [record, {...record, financial: 999}]), /Противоречивые/);
});

test('all generated forms export with original headers, complete sheets and no source formulas', () => {
 for (const schema of professionalForms) {
  const configuration = config(schema.id), result = generateProfessionalReport(schema, configuration), files = unzip(exportArchiveXlsx(result));
  assert.equal(result.config, configuration);
  assert.equal(Object.keys(files).filter(name => name.startsWith('xl/worksheets/')).length, schema.sheets.length);
  const payload = Object.values(files).join('\n');
  assert.doesNotMatch(payload, /#REF!|<f[ >]|NaN|Infinity/);
  assert.ok(archiveColumnOptions(result).length >= schema.sheets[0].columnCount);
  for (const sheet of result.sheets) for (const row of sheet.rows) assert.equal(row.length, sheet.columns.length);
 }
 const admin = unzip(exportArchiveXlsx(generate('prof-administrative')));
 assert.doesNotMatch(admin['xl/workbook.xml'], /Основания|Параметры/);
 assert.equal(admin['xl/worksheets/sheet2.xml'], undefined);
 assert.doesNotMatch(admin['xl/worksheets/sheet1.xml'], /Итого|ИТОГО/);
});

test('schemas contain only the allowlisted structural ranges, never OPI observation rows', async () => {
 const source = await readFile(new URL('../professional-schemas.js', import.meta.url), 'utf8');
 assert.doesNotMatch(source, /#REF!|=SUM\(|"БИН"\s*:\s*\d{12}/);
 for (const item of professionalForms) for (const sheet of item.sheets) {
  assert.equal(sheet.rows, undefined);
  for (const cell of Object.keys(sheet.headerCells)) assert.ok(Number(cell.match(/\d+$/)[0]) <= sheet.headerDepth);
  if (sheet.indicators) assert.ok(sheet.indicators.every(row => Object.keys(row.cells).every(key => ['B', 'D', 'E'].includes(key))));
 }
});

test('source layout retains sheet names, title rows, numbering, fixed 20-DVGA grid and body merges', () => {
 assert.deepEqual(professionalForms.map(item => item.sheets[0].sourceSheetName), ['Лист1', '08.04.25', '1 пол 2024', 'ОПИ', '1', 'КВГА табл 08.01 пересмотр']);
 const ao = generate('prof-audit-organizations').sheets[0].templateLayout;
 assert.match(ao.cells.A1, /Анализ проведенного профилактического контроля/);
 assert.equal(ao.cells.AL4, 38); assert.equal(ao.cells.A12, 'Итого'); assert.ok(ao.merges.includes('A12:C12'));
 const opi = generate('prof-public-interest').sheets[0].templateLayout;
 assert.equal(opi.cells.AT5, 51); assert.equal(opi.cells.C40, 'ИТОГО'); assert.equal(opi.cells.C42, 'ОБЩИЙ ИТОГ');
 assert.ok(opi.merges.some(range => /^A6:A\d+$/.test(range)));
 const execution = generate('prof-list-execution').sheets[0];
 assert.equal(execution.rows.length, 21); assert.equal(execution.templateLayout.rowCount, 23);
 assert.equal(execution.templateLayout.cells.A23, 'ВСЕГО'); assert.ok(execution.templateLayout.merges.includes('A23:B23'));
 for (const source of form('prof-list-execution').sheets[0].regions) assert.equal(execution.templateLayout.cells[`B${source.sourceRow}`], source.label);
 const annual = generate('prof-year-comparison').sheets[0].templateLayout;
 assert.ok(annual.merges.includes('B9:C11')); assert.ok(annual.merges.includes('B13:C15'));
 assert.equal(annual.cells.B10, undefined); assert.equal(annual.cells.B14, undefined);
 const original = form('prof-year-comparison').sheets[0].templateLayout;
 for (const key of ['columnWidths', 'rowHeights', 'pageSetup', 'pageMargins']) assert.deepEqual(annual[key], original[key]);
});

test('original percentage formats receive fractions, while UI values remain percent numbers', () => {
 const result = generate('prof-year-comparison', [base('NOW', {scope: 'ОПИ'}, {financial: 1500}), base('THEN', {scope: 'ОПИ'}, {date: '2025-06-10', financial: 1000})]);
 assert.equal(result.sheets[0].rows[5][8], 50);
 const layout = result.sheets[0].templateLayout;
 assert.equal(layout.cells.I8, .5); assert.equal(layout.styles[layout.cellStyles.I8].numberFormat, '0%');
});

test('overflow extends template rows and moves totals without dropping observations', () => {
 const objects = Array.from({length: 260}, (_, index) => base(`CASE-${index}`, {scope: 'АО', planIncluded: true, subjectRu: `Учебный субъект ${index}`}, {bin: String(index).padStart(12, '0')}));
 const list = generate('prof-halfyear-list', objects).sheets[0].templateLayout;
 assert.equal(list.rowCount, 261); assert.equal(list.cells.F261, 'Учебный субъект 259');
 assert.ok(list.cellStyles.F261 != null);
 const admin = generate('prof-administrative', objects.slice(0, 30)).sheets[0].templateLayout;
 assert.equal(admin.rowCount, 33); assert.equal(admin.cells.C33, 'Учебный субъект 29');
 assert.ok(Object.values(admin.cells).every(value => value !== 'Итого'));
 const ao = generate('prof-audit-organizations', objects.slice(0, 45)).sheets[0].templateLayout;
 assert.equal(ao.cells.C50, 'Учебный субъект 44'); assert.equal(ao.cells.A51, 'Итого'); assert.ok(ao.merges.includes('A51:C51'));
 const opiSource = objects.slice(0, 40).map(item => ({...item, professional: {...item.professional, scope: 'ОПИ'}}));
 const opi = generate('prof-public-interest', opiSource).sheets[0].templateLayout;
 assert.equal(opi.cells.C46, 'ИТОГО'); assert.equal(opi.cells.C48, 'ОБЩИЙ ИТОГ');
 assert.equal(Object.keys(opi.cells).filter(ref => /^C(?:[6-9]|[1-3]\d|4[0-5])$/.test(ref)).length, 40);
 assert.ok(opi.merges.includes('A6:A45'));
});
