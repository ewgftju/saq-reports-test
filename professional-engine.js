import {records, defaultFilters} from './data.js';
import {filterRecords} from './engine.js';
import {professionalDemoFacts, professionalPreviousRecords} from './professional-demo-data.js';

export const PROFESSIONAL_MISSING = 'Нет данных';
export const professionalReportDescriptions = {
 'prof-halfyear-list': {description: 'Полугодовой перечень субъектов профилактического контроля в двуязычной форме RU/KZ.', reportingRule: 'По отчетной дате и явному признаку включения в перечень. Все 39 колонок исходной формы сохраняются.'},
 'prof-list-execution': {description: 'Исполнение перечня по ДВГА и категориям ПО, ОПСБ, АО, ОПИ.', reportingRule: 'По отчетной дате и явному признаку включения в перечень. Статусы исполнения и специальные основания берутся из сведений дела.'},
 'prof-audit-organizations': {description: 'Результаты профилактического контроля аудиторских организаций по 17 требованиям и исполнению предписаний.', reportingRule: 'Только дела с явно указанной категорией АО. Период — по отчетной дате.'},
 'prof-public-interest': {description: 'Результаты профилактического контроля ОПИ, нарушения по пяти требованиям и их исполнение.', reportingRule: 'Только дела с явно указанной категорией ОПИ. Период — по отчетной дате.', amountUnit: 'тыс. тенге'},
 'prof-administrative': {description: 'Административные взыскания по аудиторским организациям.', reportingRule: 'Только дела АО за выбранный отчетный период.'},
 'prof-year-comparison': {description: 'Показатели профилактического контроля и изменение к аналогичному периоду прошлого года.', reportingRule: 'Основной период и те же даты прошлого года. При нулевой или отсутствующей базе процент изменения не рассчитывается.', amountUnit: 'млн тенге'}
};
const numeric = value => typeof value === 'number' && Number.isFinite(value);
const show = value => value == null || value === '' ? PROFESSIONAL_MISSING : value;
const sum = values => values.every(numeric) ? Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100 : null;
const subtract = (a, b) => numeric(a) && numeric(b) ? Math.round((a - b) * 100) / 100 : null;
const scopes = ['ПО', 'ОПСБ', 'АО', 'ОПИ'];
const fact = (record, key) => record.professional?.[key];

// API contract: professional.scope ('АО'|'ОПИ'|'ОПСБ'|'ПО'), explicit
// planIncluded + planState, requirements[{found,resolved}], notice/order/letter
// details, administrative facts, bilingual EGOV fields, and the six separate
// due/executed monetary components. Missing custom fields remain unavailable.
// Generic `status` is only a filter; it is NEVER a source for these facts.
function unique(source) {
 const map = new Map();
 for (const record of source) {
  if (record.module !== 'ПРОФ') continue;
  if (!record.id) throw new Error('У дела профилактического контроля отсутствует идентификатор.');
  if (map.has(record.id) && JSON.stringify(map.get(record.id)) !== JSON.stringify(record)) throw new Error(`Противоречивые данные дела ${record.id}.`);
  map.set(record.id, record);
 }
 return [...map.values()];
}
function previousDate(value) {
 const [year, month, day] = value.split('-').map(Number);
 const last = new Date(Date.UTC(year - 1, month, 0)).getUTCDate();
 return `${year - 1}-${String(month).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}
function makeSheet(schema, rows, headers = schema.headerCells) {
 return {id: schema.id, name: schema.name, sourceSheetName: schema.sourceSheetName, headerDepth: schema.headerDepth,
  headerCells: {...headers}, merges: [...schema.merges], ...(schema.widths ? {widths: [...schema.widths]} : {}), rows,
  columns: schema.columns.map((column, index) => ({id: column.letter, labels: column.labels,
   label: column.labels.join(' · ') || `Позиция ${column.letter}`,
   available: rows.some(row => row[index] !== null && row[index] !== PROFESSIONAL_MISSING)}))};
}
function totalRow(rows, width, columns, labelColumn = 0) {
 if (!rows.length) return rows;
 const total = Array(width).fill(null); total[labelColumn] = 'Итого';
 for (const column of columns) total[column] = show(sum(rows.map(row => row[column])));
 return [...rows, total];
}
function halfyearRows(items) {
 const keys = ['registrationDate','registrationDate', null,'subjectKz','subjectRu',null,'objectKz','objectRu',
  'addressKz','addressRu','objectAddressKz','objectAddressRu','oked','oked','kato','kato','riskKz','riskRu',
  'businessCategoryKz','businessCategoryRu','riskScore','riskScore','regionKz','regionRu','locationKz','locationRu',
  'authorityKz','authorityRu','controlAreaKz','controlAreaRu','controlPeriodKz','controlPeriodRu','authorityFullKz',
  'authorityFullRu','publishedAt','publishedAt','controlTypeKz','controlTypeRu'];
 return items.map((record, index) => [index + 1, ...keys.map((key, n) => n === 2 ? index + 1 : n === 5 ? show(record.bin) : show(fact(record, key)))]);
}
function orderFacts(record) {
 const p = record.professional || {};
 return [p.orderNumber, p.orderDate, record.deadline, p.responseNumber, p.responseDate,
  p.extendedDeadline, p.extensionLetterNumber, p.orderCount, subtract(p.orderCount, p.executedOrderCount)];
}
function aoRows(items) {
 const rows = items.map((record, index) => {
  const p = record.professional || {}, orders = orderFacts(record);
  orders[7] = p.executedOrderCount;
  return [index + 1, record.organ, p.subjectRu ?? record.object, record.bin, p.remarks,
   p.notificationNumber, p.notificationDate, ...Array.from({length: 17}, (_, n) => p.requirements?.[n]?.found),
   p.findingsDescription, p.measuresDescription, p.remarks, p.findings, p.resolvedFindings, ...orders].map(show);
 });
 return totalRow(rows, 38, [...Array.from({length: 17}, (_, n) => n + 7), 27, 28, 36, 37]);
}
function opiRows(items) {
 const rows = items.map((record, index) => {
  const p = record.professional || {}, orders = orderFacts(record);
  orders[7] = p.executedOrderCount;
  return [record.organ, index + 1, p.subjectRu ?? record.object, record.bin, p.objectRu ?? record.object,
   p.locationRu, p.riskRu, p.businessCategoryRu, p.registrationDate, p.remarks, p.notificationNumber, p.notificationDate,
   sum([record.financial, record.procedural]), p.findings, p.financialCount, record.financial,
   p.dueBudget, p.dueEnterprise, p.dueAccounting, record.procedural, record.procedureCount,
   p.financialResolvedCount, sum([p.executedBudget, p.executedEnterprise, p.executedAccounting]),
   p.executedBudget, p.executedEnterprise, p.executedAccounting, p.proceduralResolved, p.proceduralResolvedCount,
   ...Array.from({length: 4}, (_, n) => [p.requirements?.[n + 1]?.found, p.requirements?.[n + 1]?.resolved]).flat(),
   ...orders, p.remarks].map(show);
 });
 return totalRow(rows, 46, [...Array.from({length: 24}, (_, n) => n + 12), 43, 44], 2);
}
function administrativeRows(items) {
 const rows = items.map((record, index) => {
  const p = record.professional || {}, a = p.administrative || {};
  return [index + 1, record.organ, p.subjectRu ?? record.object, a.basis,
   a.applied === true ? 'Привлечен' : a.applied === false ? 'Не привлечен' : null,
   a.protocol, a.decision, a.fine, a.paid, a.receipt, p.remarks, a.executor].map(show);
 });
 return rows;
}
function regionKey(value) {
 const text = String(value || '').toLowerCase().replace(/ё/g, 'е');
 const regions = [/акмол/, /актюб|актоб/, /алматин/, /атырау/, /вко|восточно/, /алматы/, /астан/, /шымкент/,
  /жамбыл|жамбил/, /зко|западно/, /караганд/, /костан/, /кызыл/, /манг[ыи]ст|манғыст/, /абай/, /жет[іи]с/, /[ұу]лытау/,
  /павлодар/, /ско|северо/, /туркестан|түркістан/];
 return regions.findIndex(pattern => pattern.test(text));
}
function executionRows(items, schema) {
 const groups = Array.from({length: 20}, () => []);
 for (const record of items) {
  const key = regionKey(record.region) >= 0 ? regionKey(record.region) : regionKey(record.organ);
  if (key < 0) throw new Error('Не удалось определить ДВГА для строки перечня. Укажите регион из справочника.');
  groups[key].push(record);
 }
 const rows = schema.regions.map(({ordinal, label}, index) => {
  const group = groups[index];
  const classificationsKnown = group.every(record => scopes.includes(fact(record, 'scope')));
  const counts = (scope, states) => {
   if (!classificationsKnown) return Array(states.length + 1).fill(null);
   const subset = group.filter(record => fact(record, 'scope') === scope);
   const statesKnown = subset.every(record => states.includes(fact(record, 'planState')));
   return [subset.length, ...states.map(state => statesKnown ? subset.filter(record => fact(record, 'planState') === state).length : null)];
  };
  return [ordinal, label, classificationsKnown ? group.length : null,
   ...counts('ПО', ['completed', 'planned']), ...counts('ОПСБ', ['completed', 'planned']), null,
   ...counts('АО', ['completed', 'in-progress', 'planned', 'license-revoked']), null,
   ...counts('ОПИ', ['completed', 'in-progress', 'planned', 'ceased']), null].map((value, column) => [9, 15, 21].includes(column) ? null : show(value));
 });
 const result = totalRow(rows, 22, Array.from({length: 20}, (_, n) => n + 2).filter(n => ![9, 15, 21].includes(n)));
 result.at(-1)[0] = 'ВСЕГО';
 return result;
}
function measures(items, known) {
 if (!known) return {};
 const monetary = key => {const value = sum(items.map(record => record[key])); return numeric(value) ? value / 1000 : null;};
 const detail = key => {const value = sum(items.map(record => fact(record, key))); return numeric(value) ? value / 1000 : null;};
 const scopeCount = scope => items.every(record => scopes.includes(fact(record, 'scope'))) ? items.filter(record => fact(record, 'scope') === scope).length : null;
 const financial = monetary('financial'), procedural = monetary('procedural');
 const budget = detail('executedBudget'), enterprise = detail('executedEnterprise'), accounting = detail('executedAccounting');
 return {3: items.length, 4: scopeCount('АО'), 5: scopeCount('ОПСБ'), 6: scopeCount('ОПИ'),
  7: sum([financial, procedural]), 8: financial, 9: detail('dueAccounting'), 10: detail('dueBudget'), 11: detail('dueEnterprise'),
  12: sum([accounting, budget, enterprise]), 13: accounting, 14: budget, 15: enterprise,
  16: procedural, 17: detail('proceduralResolved'),
  18: sum(items.map(record => fact(record, 'orderCount'))), 19: sum(items.map(record => fact(record, 'executedOrderCount')))};
}
function comparisonSheet(schema, items, previous, filters, currentKnown, previousKnown) {
 const currentValues = measures(items, currentKnown), previousValues = measures(previous, previousKnown);
 const rows = schema.indicators.map(indicator => {
  const out = Array(schema.columnCount).fill(null);
  for (const [letter, value] of Object.entries(indicator.cells)) out[letter.charCodeAt(0) - 65] = value;
  const current = currentValues[indicator.sourceRow], baseline = previousValues[indicator.sourceRow], delta = subtract(current, baseline);
  out[5] = show(current); out[6] = show(baseline); out[7] = show(delta);
  out[8] = show(numeric(delta) && numeric(baseline) && baseline > 0 ? Math.round(delta / baseline * 10000) / 100 : null);
  return out;
 });
 const headers = {...schema.headerCells, F1: `${filters.from} — ${filters.to}`, G1: `${previousDate(filters.from)} — ${previousDate(filters.to)}`};
 const sheet = makeSheet(schema, rows, headers);
 sheet.columns[5] = {...sheet.columns[5], label: `Основной период: ${headers.F1}`, labels: ['Основной период', headers.F1]};
 sheet.columns[6] = {...sheet.columns[6], label: `Предыдущий период: ${headers.G1}`, labels: ['Предыдущий период', headers.G1]};
 return sheet;
}

const columnLetter = index => {
 let name = '';
 for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name;
 return name;
};
const columnIndex = letters => [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
const point = ref => ({column: ref.match(/^[A-Z]+/)[0], row: Number(ref.match(/\d+$/)[0])});
function moveRows(layout, at, count, modelRow) {
 if (count <= 0) return;
 const move = ref => {const p = point(ref); return `${p.column}${p.row >= at ? p.row + count : p.row}`;};
 const sourceStyles = Object.fromEntries(Array.from({length: layout.columnCount}, (_, index) => {
  const column = columnLetter(index); return [column, layout.cellStyles[`${column}${modelRow}`]];
 }));
 for (const key of ['cells', 'cellStyles']) layout[key] = Object.fromEntries(Object.entries(layout[key]).map(([ref, value]) => [move(ref), value]));
 const modelHeight = layout.rowHeights?.[modelRow];
 layout.rowHeights = Object.fromEntries(Object.entries(layout.rowHeights || {}).map(([row, height]) => [Number(row) >= at ? Number(row) + count : row, height]));
 for (let row = at; row < at + count; row++) {
  for (const [column, style] of Object.entries(sourceStyles)) if (style != null) layout.cellStyles[`${column}${row}`] = style;
  if (modelHeight != null) layout.rowHeights[row] = modelHeight;
 }
 layout.hiddenRows = (layout.hiddenRows || []).map(row => row >= at ? row + count : row);
 layout.merges = layout.merges.map(range => range.split(':').map(move).join(':'));
 const shiftArea = area => typeof area === 'string' ? area.replace(/\$?([A-Z]+)\$?(\d+)/g, (_, col, row) => `$${col}$${Number(row) >= at ? Number(row) + count : row}`) : area;
 layout.printArea = Array.isArray(layout.printArea) ? layout.printArea.map(shiftArea) : shiftArea(layout.printArea);
 layout.rowCount += count;
}
function put(layout, ref, value) {
 if (value == null) {delete layout.cells[ref]; return;}
 const style = layout.styles[layout.cellStyles[ref]], format = style?.numberFormat || '';
 if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && /[dmy]/i.test(format) && format !== 'General') {
  const date = Date.parse(`${value}T00:00:00Z`);
  if (Number.isFinite(date)) value = (date - Date.UTC(1899, 11, 30)) / 86400000;
 }
 layout.cells[ref] = value;
}
function putRow(layout, row, values) {
 values.forEach((value, index) => put(layout, `${columnLetter(index)}${row}`, value));
}
function attachTemplate(schema, sheet, items, filters) {
 const layout = structuredClone(schema.templateLayout), kind = schema.kind;
 if (kind === 'comparison') {
  // Original bodies and merges remain literal. Only the four value columns
  // change. Source I cells are percentage-formatted and need fractional values.
  sheet.rows.forEach((values, index) => {
   const row = schema.indicators[index].sourceRow;
   for (let col = 5; col < 9; col++) {
    let value = values[col];
    if (col === 8 && numeric(value) && layout.styles[layout.cellStyles[`I${row}`]]?.numberFormat.includes('%')) value /= 100;
    put(layout, `${columnLetter(col)}${row}`, value);
   }
  });
  layout.cells.F1 = `за ${filters.to.slice(0, 4)} год`;
  layout.cells.G1 = `за ${Number(filters.to.slice(0, 4)) - 1} год`;
 } else if (kind === 'execution') {
  sheet.rows.forEach((values, index) => putRow(layout, index + 3, values));
  const fromMonth = Number(filters.from.slice(5, 7)), toMonth = Number(filters.to.slice(5, 7));
  const half = fromMonth <= 6 && toMonth <= 6 ? '1-' : fromMonth >= 7 && toMonth >= 7 ? '2-' : '';
  layout.cells.C1 = `Всего по перечню ${half}${filters.to.slice(0, 4)}`;
  delete layout.cells.B23; // A23:B23 is the original merged total caption.
 } else if (kind === 'ao' || kind === 'opi') {
  const start = 6, firstTotal = kind === 'ao' ? 7 : 40, capacity = firstTotal - start;
  const extra = Math.max(0, items.length - capacity);
  moveRows(layout, firstTotal, extra, kind === 'ao' ? 6 : 39);
  const detail = items.length ? sheet.rows.slice(0, items.length) : [];
  detail.forEach((values, index) => putRow(layout, start + index, values));
  const total = items.length ? sheet.rows.at(-1) : Array(schema.columnCount).fill(0);
  for (const source of schema.totalRows) for (const column of source.columns) put(layout, `${column}${source.row + extra}`, total[columnIndex(column)]);
  if (kind === 'opi') {
   // The original region merges contain customer grouping, not observations.
   // Rebuild only these merges for the selected records, preserving all other
   // source merges and both source total captions (C40 / C42, shifted if needed).
   layout.merges = layout.merges.filter(range => {
    const [a, b] = range.split(':').map(point);
    return !(a.column === 'A' && b.column === 'A' && a.row >= start && b.row < firstTotal + extra);
   });
   let index = 0;
   while (index < items.length) {
    let end = index;
    while (end + 1 < items.length && items[end + 1].organ === items[index].organ) end++;
    if (end > index) layout.merges.push(`A${start + index}:A${start + end}`);
    for (let row = start + index + 1; row <= start + end; row++) delete layout.cells[`A${row}`];
    index = end + 1;
   }
  }
 } else {
  const start = kind === 'list' ? 2 : 4;
  const extra = Math.max(0, start + sheet.rows.length - 1 - layout.rowCount);
  moveRows(layout, layout.rowCount + 1, extra, start);
  sheet.rows.forEach((values, index) => putRow(layout, start + index, values));
 }
 sheet.templateLayout = layout;
 return sheet;
}

export function generateProfessionalReport(form, config, sourceRecords = records) {
 if (form?.engine !== 'professional') throw new Error('Неизвестная форма профилактического контроля.');
 const filters = {...defaultFilters(), ...config.filters};
 let source = unique(sourceRecords);
 if (sourceRecords === records) source = [...source.map(record => ({...record, professional: professionalDemoFacts[record.id]})), ...professionalPreviousRecords];
 let items = filterRecords(source, {sources: ['ПРОФ'], filters});
 const kind = form.sheets[0].kind;
 if (['list', 'execution'].includes(kind)) items = items.filter(record => fact(record, 'planIncluded') === true);
 if (['ao', 'administrative'].includes(kind)) items = items.filter(record => fact(record, 'scope') === 'АО');
 if (kind === 'opi') items = items.filter(record => fact(record, 'scope') === 'ОПИ');
 if (kind === 'opi') items.sort((left, right) => String(left.organ).localeCompare(String(right.organ), 'ru') || String(left.id).localeCompare(String(right.id)));
 const sheets = form.sheets.map(schema => {
  if (schema.kind === 'comparison') {
   const priorFilters = {...filters, from: previousDate(filters.from), to: previousDate(filters.to)};
   const prior = filterRecords(source, {sources: ['ПРОФ'], filters: priorFilters});
   // A provided historical population establishes source coverage; its absence
   // must not be mistaken for a zero previous-year result in custom inputs.
   const known = range => source.some(record => record.date >= range.from && record.date <= range.to);
   return attachTemplate(schema, comparisonSheet(schema, items, prior, filters, known(filters), known(priorFilters)), items, filters);
  }
  const rows = {list: halfyearRows, execution: executionRows, ao: aoRows, opi: opiRows, administrative: administrativeRows}[schema.kind](items, schema);
  return attachTemplate(schema, makeSheet(schema, rows), items, filters);
 });
 return {config, createdAt: new Date().toISOString(), recordCount: items.length,
  objectCount: new Set(items.map(record => record.bin).filter(Boolean)).size, sheets};
}
