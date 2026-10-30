import test from 'node:test';
import assert from 'node:assert/strict';
import {archiveForms, formDepartment, formNumber} from '../form-registry.js';
import {generateArchiveReport} from '../archive-engine.js';
import {exportArchiveXlsx} from '../export.js';
import {defaultFilters} from '../data.js';

// Synthetic observations only. The separate Python audit reads the private
// original in place; it never checks financial values into the repository.
const id = 'cooperation-sva-summary';
const schema = archiveForms.find(form => form.id === id);
const missing = 'Нет данных';
const institution = category => schema.sheets.find(sheet => sheet.category === category).dataRows[0].id;
const base = (caseId, category, overrides = {}, facts = {}) => ({
 id: caseId, module: 'СВА', date: '2026-03-10', region: 'Учебный регион', organ: 'Учебный орган',
 object: 'Учебная проверка', bin: '000000000001', status: 'Завершено', reportIncluded: 'Да',
 kind: 'Соответствие', coverage: 100, financial: 10, procedural: 2, due: 8, restored: 4,
 ...overrides,
 cooperation: {category, institutionId: institution(category), ...facts},
});
const generate = (source, filters = {}) => generateArchiveReport(id, {...defaultFilters(), ...filters}, source);
const decode = text => text.replace(/&(amp|lt|gt|quot|apos);/g, (_, key) => ({amp:'&', lt:'<', gt:'>', quot:'"', apos:"'"}[key]));
const attribute = (text, name, fallback = '') => text.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? fallback;

function unzip(bytes) {
 const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), decoder = new TextDecoder(), files = {};
 for (let offset = 0; offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50;) {
  assert.equal(view.getUint16(offset + 8, true), 0, 'Application XLSX uses ZIP store mode');
  const size = view.getUint32(offset + 18, true), names = view.getUint16(offset + 26, true), extra = view.getUint16(offset + 28, true);
  const start = offset + 30 + names + extra;
  files[decoder.decode(bytes.slice(offset + 30, offset + 30 + names))] = decoder.decode(bytes.slice(start, start + size));
  offset = start + size;
 }
 return files;
}
function exported(report) {
 const files = unzip(exportArchiveXlsx(report));
 const names = [...files['xl/workbook.xml'].matchAll(/<sheet\b([^>]*)\/?\s*>/g)].map(match => decode(attribute(match[1], 'name')));
 const sheets = Object.fromEntries(names.map((name, index) => {
  const xml = files[`xl/worksheets/sheet${index + 1}.xml`], cells = {};
  for (const match of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
   const body = match[2] || '';
   const text = [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(value => decode(value[1])).join('');
   const value = body.match(/<v>([^<]*)<\/v>/)?.[1];
   if (text !== '') cells[attribute(match[1], 'r')] = text;
   else if (value !== undefined) cells[attribute(match[1], 'r')] = Number(value);
  }
  return [name, cells];
 }));
 return {files, names, sheets};
}
function assertFonts(files) {
 const styles = files['xl/styles.xml'];
 const fonts = [...styles.match(/<fonts\b[^>]*>([\s\S]*?)<\/fonts>/)[1].matchAll(/<font\b[^>]*>([\s\S]*?)<\/font>/g)]
  .map(match => decode(match[1].match(/<name\b[^>]*val="([^"]+)"/)?.[1] || ''));
 const xfs = [...styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)[1].matchAll(/<xf\b([^>]*)(?:\/>|>)/g)]
  .map(match => Number(attribute(match[1], 'fontId', 0)));
 for (const [name, xml] of Object.entries(files).filter(([path]) => /^xl\/worksheets\//.test(path))) {
  assert.doesNotMatch(xml, /<f(?:\s|>)|#REF!|NaN|Infinity/, `${name}: no source formulas/errors`);
  for (const match of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
   if (!/<v>|<t(?:\s|>)/.test(match[2] || '')) continue;
   assert.equal(fonts[xfs[Number(attribute(match[1], 's', 0))]], 'Times New Roman', `${name}: actual cell font`);
  }
 }
}

test('first cooperation report adds exactly four original sheets and preserves blank source columns', () => {
 assert.ok(schema);
 assert.equal(formDepartment(schema), 'audit-cooperation');
 assert.equal(formNumber(schema), 1);
 assert.equal(archiveForms.length, 32);
 assert.equal(archiveForms.reduce((count, form) => count + form.sheets.length, 0), 41);
 assert.deepEqual(schema.sheets.map(sheet => sheet.sourceSheetName), ['ЦГО', 'МИО', 'ДП', 'ИТОГО']);
 assert.deepEqual(schema.sheets.map(sheet => sheet.columnCount), [51, 51, 49, 45]);
 assert.deepEqual(schema.sheets.map(sheet => sheet.dataRows.length), [30, 20, 20, 3]);
 const result = exported(generate());
 assert.deepEqual(result.names, ['ЦГО', 'МИО', 'ДП', 'ИТОГО']);
 assert.doesNotMatch(result.files['xl/workbook.xml'], /Параметры/);
 for (const [name, columns, first, last] of [['МИО', ['H'], 2, 24], ['ДП', ['G', 'H'], 4, 26]])
  for (const column of columns) for (let row = first; row <= last; row++)
   assert.equal(result.sheets[name][`${column}${row}`], undefined, `${name}!${column}${row}: preserve blank spacer`);
 assert.equal(result.sheets['ЦГО'].A34, 'Итого');
 assert.equal(result.sheets['МИО'].A24, 'итого');
 assert.equal(result.sheets['ДП'].A26, 'Итого');
 assert.equal(result.sheets['ИТОГО'].A7, 'Итого');
 assert.equal(result.sheets['МИО'].AU2, schema.sheets[0].headerCells.AQ2);
 assertFonts(result.files);
});

test('actual exports reconcile institutions and category totals without duplicating institution snapshots', () => {
 const snapshot = {annualPlan: 10, staff: 7, actualStaff: 6, certifiedStaff: 5};
 const source = [
  base('MIO-A', 'МИО', {}, {institutionIndicators: snapshot, asOf: '2026-09-30', auditIndicators: {planCovered: 3}}),
  base('MIO-B', 'МИО', {date: '2026-07-10', coverage: 200, financial: 20, procedural: 3},
   {institutionIndicators: {...snapshot}, asOf: '2026-09-30', auditIndicators: {planCovered: 2}}),
  base('CGO-A', 'ЦГО', {financial: 5}), base('DP-A', 'ДП', {financial: 3}),
 ];
 const report = generate(source), {sheets} = exported(report);
 assert.equal(report.recordCount, 4);
 assert.equal(sheets['МИО'].Q4, 300); assert.equal(sheets['МИО'].S4, 30); assert.equal(sheets['МИО'].R4, 35);
 assert.equal(sheets['МИО'].C4, 10); assert.equal(sheets['МИО'].AS4, 7);
 assert.equal(sheets['МИО'].E4, 5); assert.equal(sheets['МИО'].F4, .5);
 assert.equal(sheets['МИО'].C24, 10); assert.equal(sheets['МИО'].F24, .5);
 assert.equal(sheets['ИТОГО'].L4, 5); assert.equal(sheets['ИТОГО'].L5, 30); assert.equal(sheets['ИТОГО'].L6, 3);
 assert.equal(sheets['ИТОГО'].L7, 38);
 assert.equal(sheets['ИТОГО'].J7, 500);
 assert.equal(sheets['ИТОГО'].AL5, 7);
 assert.equal(sheets['ЦГО'].J4, missing, 'Unlabelled additional block cannot be inferred from audit count');
 assert.equal(sheets['МИО'].U4, missing, 'Unavailable procurement coverage must not become zero');
 assert.equal(sheets['МИО'].S5, undefined, 'Unused template institution is blank');
});

test('period, region and organ filters update exported totals and the selected quarter', () => {
 const source = [base('Q1', 'МИО'), base('Q3', 'МИО', {date: '2026-07-10', financial: 20}),
  base('OTHER-REGION', 'МИО', {financial: 50, region: 'Иной регион', organ: 'Иной орган'}),
  base('UNFINISHED', 'МИО', {status: 'В работе', financial: 900}),
  base('EXCLUDED', 'МИО', {reportIncluded: 'Нет', financial: 900}),
  base('OTHER-MODULE', 'МИО', {module: 'ВГА', financial: 900})];
 const filtered = generate(source, {region: 'Учебный регион', organ: 'Учебный орган'});
 assert.equal(filtered.recordCount, 2);
 const september = exported(filtered).sheets;
 assert.equal(september['МИО'].S4, 30); assert.equal(september['ИТОГО'].L7, 30);
 assert.equal(september['МИО'].M4, 1); assert.equal(september['МИО'].N4, 1);
 const june = exported(generate(source, {region: 'Учебный регион', organ: 'Учебный орган', to: '2026-06-30'})).sheets;
 assert.equal(june['МИО'].S4, 10); assert.equal(june['ИТОГО'].L7, 10);
 assert.equal(june['МИО'].M4, 0); assert.match(june['МИО'].M2, /2 квартал 2026/);
 assert.match(june['МИО'].L1, /6 месяцев 2026/);
 const absent = generate(source, {query: 'no-such-case'});
 assert.equal(absent.recordCount, 0);
 assert.equal(exported(absent).sheets['ИТОГО'].L7, undefined);
});

test('arbitrary dates update report captions while retaining the explicitly historical source column', () => {
 const {sheets} = exported(generate([], {from: '2030-04-05', to: '2030-05-20'}));
 for (const [name, title] of [['ЦГО', 'B1'], ['МИО', 'L1'], ['ДП', 'B3'], ['ИТОГО', 'B1']])
  assert.match(sheets[name][title], /05\.04\.2030.*20\.05\.2030/);
 assert.equal(sheets['МИО'].D2, schema.sheets[1].headerCells.D2);
 assert.match(sheets['МИО'].I2, /2030/); assert.match(sheets['МИО'].M2, /2 квартал 2030/);
 assert.equal(sheets['ДП'].D3, '2 квартал'); assert.equal(sheets['ДП'].D4, 'Перечень 2 кв');
 assert.match(sheets['ДП'].E3, /2030/);
});

test('missing measures and unknown audit types remain distinct from explicit zero', () => {
 const source = [base('UNKNOWN', 'МИО', {financial: undefined, kind: undefined}, {auditIndicators: {procurementCoverage: 0}})];
 const {sheets} = exported(generate(source));
 assert.equal(sheets['МИО'].I4, 1);
 assert.equal(sheets['МИО'].J4, missing); assert.equal(sheets['МИО'].K4, missing);
 assert.equal(sheets['МИО'].S4, missing); assert.equal(sheets['МИО'].S24, missing); assert.equal(sheets['ИТОГО'].L7, missing);
 assert.equal(sheets['МИО'].U4, 0); assert.equal(sheets['МИО'].U24, 0); assert.equal(sheets['ИТОГО'].N7, 0);
 assert.equal(sheets['МИО'].F4, missing);
});

test('duplicate cases, unmatched institutions and conflicting institution snapshots cannot silently change totals', () => {
 const record = base('SAME', 'МИО');
 assert.equal(generate([record, structuredClone(record)]).recordCount, 1);
 assert.throws(() => generate([record, {...record, financial: 999}]), /Противоречивые/);
 assert.throws(() => generate([base('UNMAPPED', 'МИО', {}, {institutionId: 'not-in-source'})]), /не указана СВА/);
 const first = base('SNAPSHOT-A', 'МИО', {}, {asOf: '2026-09-01', institutionIndicators: {staff: 7}});
 const second = base('SNAPSHOT-B', 'МИО', {}, {asOf: '2026-09-01', institutionIndicators: {staff: 8}});
 assert.throws(() => generate([first, second]), /Противоречивые показатели/);
 const latest = {...second, cooperation: {...second.cooperation, asOf: '2026-09-02'}};
 assert.equal(exported(generate([first, latest])).sheets['МИО'].AS4, 8);
});
