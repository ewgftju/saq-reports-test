import test from 'node:test';
import assert from 'node:assert/strict';
import {records, modules, defaultFilters} from '../data.js';
import {analyticsRecords} from '../analytics-data.js';
import {buildAnalytics, comparisonChange, previousYearPeriod} from '../analytics-engine.js';

const options = overrides => ({sources: [...modules], filters: defaultFilters(), organs: [], comparison: {mode: 'previous-year'}, ...overrides});
const row = (id, date, overrides = {}) => ({id, module: 'ВГА', date, region: 'R', organ: 'ДВГА · R', bin: '1', status: 'Завершено', object: 'Объект', coverage: 100, financial: 20, due: 20, restored: 10, ...overrides});

test('analytics fixtures add a distinct prior year without changing the report dataset', () => {
 assert.equal(records.length, 120);
 assert.ok(records.every(record => record.date.startsWith('2026')));
 assert.equal(analyticsRecords.filter(record => record.date.startsWith('2025')).length, 100);
 assert.equal(new Set(analyticsRecords.map(record => `${record.module}:${record.id}`)).size, analyticsRecords.length);
 const result = buildAnalytics(analyticsRecords, options());
 assert.equal(result.error, '');
 assert.equal(result.totals.current.count, 120);
 assert.equal(result.totals.previous.count, 100);
 assert.notEqual(result.totals.current.financial, result.totals.previous.financial);
 assert.deepEqual(result.comparisonPeriod, {from: '2025-01-01', to: '2025-09-30'});
 const priorIds = new Set(analyticsRecords.filter(record => record.module === 'ВГА').map(record => record.id));
 assert.ok(analyticsRecords.filter(record => record.parentId).every(record => priorIds.has(record.parentId)));
});

test('prior-year periods clamp leap day and reject invalid dates', () => {
 assert.deepEqual(previousYearPeriod({from: '2024-02-29', to: '2024-03-31'}), {from: '2023-02-28', to: '2023-03-31'});
 assert.deepEqual(previousYearPeriod({from: '2025-02-28', to: '2025-03-01'}), {from: '2024-02-28', to: '2024-03-01'});
 assert.equal(previousYearPeriod({from: '2025-02-29', to: '2025-03-01'}), null);
 assert.equal(previousYearPeriod({from: '2026-03-01', to: '2026-02-01'}), null);
});

test('current and custom comparison periods include both boundaries', () => {
 const rows = ['2026-01-01', '2026-01-31', '2025-10-01', '2025-10-31', '2025-09-30', '2025-11-01'].map((date, i) => row(String(i), date));
 const result = buildAnalytics(rows, options({filters: {...defaultFilters(), from: '2026-01-01', to: '2026-01-31'}, comparison: {mode: 'custom', from: '2025-10-01', to: '2025-10-31'}}));
 assert.equal(result.totals.current.count, 2);
 assert.equal(result.totals.previous.count, 2);
 assert.deepEqual(result.comparisonPeriod, {from: '2025-10-01', to: '2025-10-31'});
});

test('non-date filters and multiple selected organs apply identically to both periods', () => {
 const rows = [];
 for (const year of ['2025', '2026']) {
  rows.push(row(`${year}-a`, `${year}-02-01`, {organ: 'ДВГА · A', object: 'Искомый объект'}));
  rows.push(row(`${year}-b`, `${year}-02-01`, {organ: 'ДВГА · B', object: 'Искомый объект'}));
  rows.push(row(`${year}-c`, `${year}-02-01`, {organ: 'ДВГА · C', object: 'Искомый объект'}));
  rows.push(row(`${year}-d`, `${year}-02-01`, {organ: 'ДВГА · A', object: 'Другой'}));
  rows.push(row(`${year}-e`, `${year}-02-01`, {organ: 'ДВГА · A', object: 'Искомый объект', region: 'X'}));
  rows.push(row(`${year}-f`, `${year}-02-01`, {organ: 'ДВГА · A', object: 'Искомый объект', status: 'В работе'}));
 }
 const result = buildAnalytics(rows, options({sources: ['ВГА'], organs: ['ДВГА · A', 'ДВГА · B'], filters: {...defaultFilters(), query: 'ИСКОМЫЙ', region: 'R', status: 'Завершено'}}));
 assert.equal(result.totals.current.count, 2);
 assert.equal(result.totals.previous.count, 2);
 assert.equal(result.byOrgan.length, 2);
});

test('comparison includes past-only and explicitly selected empty organs', () => {
 const result = buildAnalytics([row('old', '2025-01-01', {organ: 'ДВГА · Old'}), row('new', '2026-01-01', {organ: 'ДВГА · New'})], options());
 assert.deepEqual(result.byOrgan.map(item => item.organ), ['ДВГА · New', 'ДВГА · Old']);
 assert.equal(result.byOrgan[1].current.count, 0);
 assert.equal(result.byOrgan[1].current.financial, null);
 const empty = buildAnalytics([], options({organs: ['ДВГА · Empty']}));
 assert.equal(empty.byOrgan[0].organ, 'ДВГА · Empty');
 assert.equal(empty.byOrgan[0].previous.count, 0);
});

test('deduplication respects module IDs and full organ names without joining by BIN', () => {
 const a = row('one', '2026-01-01');
 const b = row('two', '2026-01-01');
 const sva = row('one', '2026-01-01', {module: 'СВА', organ: 'СВА · R'});
 const result = buildAnalytics([a, a, b, sva], options());
 assert.equal(result.totals.current.count, 3);
 assert.equal(result.totals.current.objectCount, 1);
 assert.equal(result.totals.current.financial, 60);
 assert.equal(result.byOrgan.length, 2);
});

test('money excludes risk and objections, preserves known zero, and rate is weighted', () => {
 const rows = [row('a', '2026-01-01', {due: 100, restored: 10, financial: 0}), row('b', '2026-01-01', {due: 300, restored: 210, financial: 0}), row('c', '2026-01-01', {module: 'Возражения', financial: 900, due: 900, restored: 900}), row('d', '2026-01-01', {module: 'СУР', financial: 900})];
 const result = buildAnalytics(rows, options());
 assert.equal(result.totals.current.financial, 0);
 assert.ok(Math.abs(result.totals.current.elimination - 55) < 1e-10);
 assert.equal(result.totals.current.restored, 220);
 assert.equal(result.byModule.find(item => item.module === 'Возражения').current.financial, null);
 assert.equal(buildAnalytics([row('zero', '2026-01-01', {due: 0, restored: 0})], options()).totals.current.elimination, null);
 assert.equal(buildAnalytics([row('missing', '2026-01-01', {restored: null})], options()).totals.current.elimination, null);
});

test('changes distinguish zero baselines, missing values and percentage points', () => {
 assert.deepEqual(comparisonChange(150, 100), {absolute: 50, percent: 50});
 assert.deepEqual(comparisonChange(100, 0), {absolute: 100, percent: null});
 assert.deepEqual(comparisonChange(0, 0), {absolute: 0, percent: null});
 assert.deepEqual(comparisonChange(null, 100), {absolute: null, percent: null});
 assert.deepEqual(comparisonChange(60, 50, {percentagePoints: true}), {absolute: 10, percent: null});
});

test('invalid dates, sources, organs and custom periods reject comparison', () => {
 for (const overrides of [
  {sources: []}, {sources: ['unknown']}, {sources: ['ВГА', 'ВГА']}, {organs: 'ДВГА · R'},
  {filters: {...defaultFilters(), from: '2026-02-30'}},
  {filters: {...defaultFilters(), from: '2026-10-01', to: '2026-01-01'}},
  {comparison: {mode: 'custom', from: '2025-02-29', to: '2025-03-31'}},
  {comparison: {mode: 'custom', from: '2025-12-01', to: '2025-01-01'}},
  {comparison: {mode: 'custom', from: '', to: ''}}, {comparison: {mode: 'unknown'}}
 ]) {
  const result = buildAnalytics(analyticsRecords, options(overrides));
  assert.ok(result.error, JSON.stringify(overrides));
  assert.equal(result.currentRows.length, 0);
 }
});

test('comparison can be disabled without requiring comparison dates or mutating settings', () => {
 const config = options({comparison: {mode: 'none', from: 'invalid', to: 'invalid'}});
 const before = structuredClone(config);
 const result = buildAnalytics(analyticsRecords, config);
 assert.equal(result.error, '');
 assert.equal(result.totals.current.count, 120);
 assert.deepEqual(result.previousRows, []);
 assert.equal(result.comparisonPeriod, null);
 assert.deepEqual(config, before);
});
