import {defaultFilters} from './data.js';
import {filterRecords, validate} from './engine.js';

const auditModules = new Set(['ВГА', 'СВА', 'ПРОФ']);
const numeric = value => typeof value === 'number' && Number.isFinite(value);
const unique = rows => [...new Map(rows.map(row => [`${row.module}:${row.id}`, row])).values()];

function validDate(value) {
 if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
 const date = new Date(`${value}T00:00:00Z`);
 return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
}

function shiftYear(value) {
 const [year, month, day] = value.split('-').map(Number);
 // Move 29 February to 28 February when the preceding year is not a leap year.
 const priorYear = year - 1;
 const leap = priorYear % 4 === 0 && (priorYear % 100 !== 0 || priorYear % 400 === 0);
 return `${String(priorYear).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(month === 2 && day === 29 && !leap ? 28 : day).padStart(2, '0')}`;
}

export function previousYearPeriod({from, to} = {}) {
 if (!validDate(from) || !validDate(to) || from > to || from.startsWith('0001')) return null;
 return {from: shiftYear(from), to: shiftYear(to)};
}

export function comparisonChange(current, previous, {percentagePoints = false} = {}) {
 if (!numeric(current) || !numeric(previous)) return {absolute: null, percent: null};
 const absolute = current - previous;
 return {absolute, percent: percentagePoints || previous === 0 ? null : absolute / Math.abs(previous) * 100};
}

function summarize(rows) {
 const audits = rows.filter(row => auditModules.has(row.module));
 const sum = key => {
  const values = audits.map(row => row[key]).filter(numeric);
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
 };
 const totals = {
  count: rows.length,
  objectCount: new Set(rows.map(row => row.bin).filter(Boolean)).size,
  coverage: sum('coverage'), financial: sum('financial'), restored: sum('restored'), due: sum('due')
 };
 // Do not derive a rate from differently populated numerator/denominator sets.
 const completeRate = audits.length > 0 && audits.every(row => numeric(row.due) && numeric(row.restored));
 totals.elimination = completeRate && totals.due > 0 ? totals.restored / totals.due * 100 : null;
 return totals;
}

function resultError(error) {
 return {currentRows: [], previousRows: [], totals: {current: summarize([]), previous: summarize([])}, byOrgan: [], byModule: [], comparisonPeriod: null, error};
}

export function buildAnalytics(records, {sources, filters = {}, organs = [], comparison = {mode: 'previous-year'}} = {}) {
 const f = {...defaultFilters(), ...filters};
 const config = {dataset: 'registry', sources, filters: f, group: 'module', columns: ['module', 'count', 'objectCount']};
 const error = validate(config);
 if (error) return resultError(error);
 if (!validDate(f.from) || !validDate(f.to)) return resultError('Проверьте даты основного периода.');
 if (!Array.isArray(organs) || organs.some(organ => typeof organ !== 'string' || !organ.trim())) return resultError('Проверьте список органов аудита.');
 const mode = comparison?.mode || 'previous-year';
 if (!['previous-year', 'custom', 'none'].includes(mode)) return resultError('Выберите режим сравнения.');
 let comparisonPeriod = null;
 if (mode === 'previous-year') {
  comparisonPeriod = previousYearPeriod(f);
  if (!comparisonPeriod) return resultError('Для выбранного периода невозможно определить предыдущий год.');
 } else if (mode === 'custom') {
  const {from, to} = comparison;
  if (!validDate(from) || !validDate(to)) return resultError('Укажите корректные даты периода сравнения.');
  if (from > to) return resultError('Начало периода сравнения не может быть позже окончания.');
  comparisonPeriod = {from, to};
 }
 const selectedOrgans = [...new Set(organs)];
 const select = period => unique(filterRecords(records, {...config, filters: {...f, ...period}})
  .filter(row => !selectedOrgans.length || selectedOrgans.includes(row.organ)));
 const currentRows = select({from: f.from, to: f.to});
 const previousRows = comparisonPeriod ? select(comparisonPeriod) : [];
 const organNames = [...new Set([...selectedOrgans, ...currentRows.map(row => row.organ), ...previousRows.map(row => row.organ)])]
  .filter(Boolean).sort((a, b) => a.localeCompare(b, 'ru'));
 const groups = (keys, field) => keys.map(key => ({
  [field]: key,
  current: summarize(currentRows.filter(row => row[field] === key)),
  previous: summarize(previousRows.filter(row => row[field] === key))
 }));
 return {
  currentRows, previousRows,
  totals: {current: summarize(currentRows), previous: summarize(previousRows)},
  byOrgan: groups(organNames, 'organ'), byModule: groups(sources, 'module'), comparisonPeriod, error: ''
 };
}
