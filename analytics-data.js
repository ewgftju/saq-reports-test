import {records} from './data.js';

// Explicitly synthetic prior-year fixtures, used only by the analytics view.
// Keep the report/archive datasets unchanged and never copy customer facts here.
const previousYear = value => typeof value === 'string' ? value.replace('2026', '2025') : value;
const priorRecords = records.filter((_, index) => index % 24 % 7 !== 0).map((record, index) => {
 const factor = 0.72 + (Number(record.organCode) % 6) * 0.055;
 const scale = value => typeof value === 'number' ? Math.round(value * factor) : value;
 const financial = scale(record.financial);
 return {
  ...record,
  id: previousYear(record.id), date: previousYear(record.date), month: previousYear(record.month),
  parentId: previousYear(record.parentId), deadline: previousYear(record.deadline),
  coverage: scale(record.coverage), financial, procedural: scale(record.procedural), due: financial,
  restored: financial == null ? null : Math.round(financial * (record.status === 'Завершено' ? 0.76 : 0.28)),
  score: record.score == null ? null : Math.min(100, record.score + index % 6)
 };
});

export const analyticsRecords = [...records, ...priorRecords];
