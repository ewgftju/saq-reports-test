import {records, defaultFilters} from './data.js';
import {filterRecords} from './engine.js';
import {planMonitoringValues, planDetailValues, expandPlanLayout} from './received-engine.js';

const missing = 'Нет данных';
const number = value => typeof value === 'number' && Number.isFinite(value);
const display = value => value == null || value === '' ? missing : value;
const sum = (rows, key) => rows.every(row => number(row[key])) ? rows.reduce((total, row) => total + row[key], 0) : null;
const happened = (date, to) => typeof date === 'string' && date <= to;
const formatDate = date => date.split('-').reverse().join('.');
const demoInstitutions = {'г. Астана':'mio-15','г. Алматы':'mio-16','Акмолинская область':'mio-01','Атырауская область':'mio-04','Карагандинская область':'mio-08','Туркестанская область':'mio-14'};

export const cooperationPlanReportDescriptions = {
 'cooperation-plan-detail': {
  amountUnit:'млн тенге',
  reportingRule:'Перечень СВА за год даты «по». Назначения, завершения и исключения учитываются на дату «по». Суммы нарушений показываются после завершения аудита. Листы ЦГО и МИО формируются отдельно.',
  description:'Исполнение Перечня объектов государственного аудита СВА ЦГО и СВА МИО.'
 },
 'cooperation-plan-monitoring': {
  amountUnit:'количество; проценты',
  reportingRule:'Действующий Перечень СВА за год даты «по». События учитываются накопительно на эту дату, квартал — по плановому сроку. Остаток = план − завершено. Проценты — от годового плана. Итоги рассчитаны по представленным данным.',
  description:'Мониторинг исполнения Перечня по СВА ЦГО, СВА МИО и департаментам полиции.'
 }
};

// Synthetic plan facts only. Supplied records never receive these defaults.
function demoSource() {
 return records.filter(row => row.module === 'СВА').map((row, index) => {
  const quarter = Math.floor(index / 6) + 1;
  const month = String((quarter - 1) * 3 + 1).padStart(2, '0');
  const assignedAt = index % 5 === 0 ? null : `2026-${month}-05`;
  const completedAt = assignedAt && index % 3 !== 1 ? `2026-${month}-25` : null;
  return {...row, auditType:'Плановый', auditorPosition:'Специалист (учебный пример)',
   cooperation:{category:'МИО', institutionId:demoInstitutions[row.region]},
   plan:{year:2026, quarter, kind:row.kind, coverage:(index + 10) * 15000,
    event:`Учебное аудиторское мероприятие СВА ${index + 1}`,
    legacyCaseNumber:`ДЕМО-СВА-${index + 1}`, assignedAt, completedAt,
    excludedAt:index === 7 ? '2026-05-20' : null,
    exclusionReason:index === 7 ? 'Изменение учебного перечня' : null,
    orderNumber:assignedAt ? `ПР-СВА-ДЕМО-${index + 1}` : null}};
 });
}

function select(form, source, filters) {
 const unique = new Map();
 for (const row of source === records ? demoSource() : source) {
  if (row.module !== 'СВА') continue;
  if (!row.id) throw new Error('У позиции Перечня отсутствует идентификатор.');
  if (unique.has(row.id) && JSON.stringify(unique.get(row.id)) !== JSON.stringify(row))
   throw new Error(`Противоречивые данные позиции Перечня ${row.id}.`);
  unique.set(row.id, row);
 }
 // A plan's membership and event dates determine inclusion, not an audit's
 // report date. The other common filters continue to apply unchanged.
 const candidates = [...unique.values()];
 const keys = new Set(filterRecords(candidates.map(row => ({...row, date:filters.to})), {sources:['СВА'], filters}).map(row => row.id));
 const rows = candidates.filter(row => keys.has(row.id) && (row.plan?.year == null || row.plan.year === Number(filters.to.slice(0, 4))));
 for (const row of rows) {
  if (!['ЦГО','МИО','ДП'].includes(row.cooperation?.category))
   throw new Error(`Для позиции «${row.id}» не указана категория СВА: ЦГО, МИО или ДП.`);
  for (const key of ['assignedAt','completedAt','excludedAt']) {
   const value = row.plan?.[key];
   if (value == null) continue;
   const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : null;
   if (!date || !Number.isFinite(+date) || date.toISOString().slice(0,10) !== value)
    throw new Error(`Некорректная дата ${key} у позиции «${row.id}».`);
  }
  if (row.plan?.completedAt && row.plan.assignedAt !== undefined && (!row.plan.assignedAt || row.plan.completedAt < row.plan.assignedAt))
   throw new Error(`Завершение позиции «${row.id}» не может предшествовать назначению.`);
 }
 return form.id === 'cooperation-plan-detail'
  ? rows.filter(row => ['ЦГО','МИО'].includes(row.cooperation.category))
  : rows.filter(row => !happened(row.plan?.excludedAt, filters.to));
}

function sheetResult(schema, layout, entries, filters) {
 for (const entry of entries) for (const column of schema.columns) {
  if (column.labels.length && Object.hasOwn(entry, column.letter))
   layout.cells[`${column.letter}${entry._sourceRow}`] = display(entry[column.letter]);
 }
 const columns = schema.columns.map(column => {
  const labels = column.labels.map(label => label.replace(/на 20\d\d год/, `на ${filters.to.slice(0,4)} год`));
  return {id:column.letter, label:labels.join(' · ') || `Позиция ${column.letter}`, labels, group:labels[0] || '', available:labels.length > 0};
 });
 return {id:schema.id, name:schema.name, sourceSheetName:schema.sourceSheetName,
  columns, headerCells:schema.headerCells, headerDepth:schema.headerDepth, merges:schema.merges,
  templateLayout:layout, sourceRowNumbers:entries.map(entry => entry._sourceRow),
  rows:entries.map(entry => schema.columns.map(column => layout.cells[`${column.letter}${entry._sourceRow}`] ?? null))};
}

function detailSheet(schema, items, filters) {
 const layout = structuredClone(schema.templateLayout), placement = schema.sourcePlacement;
 const values = items.filter(row => row.cooperation.category === schema.category).map((row, index) => {
  const auditor = row.auditor && row.auditorPosition ? `${row.auditor}, ${row.auditorPosition}` : row.auditor;
  return planDetailValues({...row, id:row.plan?.legacyCaseNumber, auditor}, filters.to, index);
 });
 const slots = placement.dataEnd - placement.dataStart + 1;
 expandPlanLayout(layout, placement, values.length);
 const entries = Array.from({length:Math.max(slots, values.length)}, (_, index) => ({...values[index], _sourceRow:placement.dataStart + index}));
 const totalRow = placement.totalRow + Math.max(0, values.length - slots);
 const total = {_sourceRow:totalRow, B:layout.cells[`B${totalRow}`]};
 if (values.length) for (const key of ['J','K','L','M']) total[key] = sum(values, key);
 entries.push(total);
 layout.cells.A4 = layout.cells.A4.replace(/за\s+_+\s+_+\s+20_+ года/, `за ${filters.to.slice(0,4)} год по состоянию на ${formatDate(filters.to)}`);
 if (schema.category === 'МИО' && filters.region)
  layout.cells.A4 = layout.cells.A4.replace(/по _+ области/, `по ${filters.region}`);
 return sheetResult(schema, layout, entries, filters);
}

function monitoringSheet(schema, items, filters) {
 const layout = structuredClone(schema.templateLayout);
 for (const row of items) {
  if (!schema.dataRows.some(institution => institution.category === row.cooperation.category && institution.id === row.cooperation.institutionId))
   throw new Error(`СВА позиции «${row.id}» отсутствует среди подразделений исходной формы мониторинга.`);
 }
 const totalIds = new Set(schema.totalRows.map(row => row.id));
 const entries = [...schema.dataRows, ...schema.totalRows].sort((a, b) => a.sourceRow - b.sourceRow).map(institution => {
  const isTotal = totalIds.has(institution.id);
  const members = items.filter(row => isTotal
   ? institution.category === 'all' || row.cooperation.category === institution.category
   : row.cooperation.category === institution.category && row.cooperation.institutionId === institution.id);
  return {_sourceRow:institution.sourceRow, ...(members.length ? planMonitoringValues(members, filters.to) : {})};
 });
 layout.cells.B4 = layout.cells.B4.replace(/_+ год/, `${filters.to.slice(0,4)} год`);
 layout.cells.B6 = layout.cells.B6.replace(/_+/, formatDate(filters.to));
 layout.cells.D8 = layout.cells.D8.replace(/20\d\d/, filters.to.slice(0,4));
 return sheetResult(schema, layout, entries, filters);
}

export function generateCooperationPlanReport(form, config, source = records) {
 const filters = {...defaultFilters(), ...config.filters};
 const items = select(form, source, filters);
 const sheets = form.sheets.map(schema => form.id === 'cooperation-plan-detail'
  ? detailSheet(schema, items, filters) : monitoringSheet(schema, items, filters));
 return {config:{...config, ...cooperationPlanReportDescriptions[form.id], filters}, createdAt:new Date().toISOString(),
  recordCount:items.length, objectCount:new Set(items.map(row => row.bin).filter(Boolean)).size, sheets};
}
