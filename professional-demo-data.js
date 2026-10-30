import {records} from './data.js';

// Explicit synthetic PK facts. They are attached ONLY to the built-in demo
// records by identity in professional-engine.js. Real/custom records must carry
// their own `professional` facts; generic audit status never determines scope,
// plan inclusion, license revocation, cessation, or statutory requirements.
const amount = value => Math.round(value * 100) / 100;
function fixture(record, index) {
 const scope = ['ОПИ', 'АО', 'ОПСБ', 'ПО'][index % 4];
 const sequence = Math.floor(index / 4);
 const states = scope === 'АО' ? ['completed', 'planned', 'in-progress', 'license-revoked']
  : scope === 'ОПИ' ? ['completed', 'planned', 'in-progress', 'ceased'] : ['completed', 'planned'];
 const planState = states[sequence % states.length];
 const found = Array.from({length: scope === 'АО' ? 17 : 5}, (_, n) => (index + n) % 3 === 0 ? 1 : 0);
 const requirements = found.map(count => ({found: count, resolved: planState === 'completed' ? count : 0}));
 const financialCount = record.financial > 0 ? 1 + index % 3 : 0;
 if (scope === 'ОПИ') requirements[0] = {found: financialCount + record.procedureCount,
  resolved: planState === 'completed' ? financialCount + record.procedureCount : 0};
 const dueBudget = amount(record.financial * .4), dueEnterprise = amount(record.financial * .3);
 const executedBudget = amount(record.restored * .4), executedEnterprise = amount(record.restored * .3);
 const adminApplied = sequence % 2 === 0;
 return {
  scope, planIncluded: true, planState,
  subjectKz: `«Оқу субъектісі ${index + 1}» ЖШС`, subjectRu: record.object,
  objectKz: `Оқу нысаны ${index + 1}`, objectRu: record.object,
  registrationDate: `2020-01-${String(index % 20 + 1).padStart(2, '0')}`,
  addressKz: `Оқу мекенжайы, ${index + 1}`, addressRu: `Учебный адрес, ${index + 1}`,
  objectAddressKz: `Оқу нысанының мекенжайы, ${index + 1}`, objectAddressRu: `Учебный адрес объекта, ${index + 1}`,
  oked: '00000', kato: '000000000', riskKz: 'Жоғары', riskRu: 'Высокий',
  businessCategoryKz: 'Шағын', businessCategoryRu: 'Малый', riskScore: 70 + index,
  regionKz: `Оқу өңірі ${index % 6 + 1}`, regionRu: record.region,
  locationKz: `Оқу нысанының мекенжайы, ${index + 1}`, locationRu: `Учебный адрес объекта, ${index + 1}`,
  authorityKz: 'ІМАК', authorityRu: 'КВГА', authorityFullKz: 'Ішкі мемлекеттік аудит комитеті', authorityFullRu: 'Комитет внутреннего государственного аудита',
  controlAreaKz: 'Профилактикалық бақылау', controlAreaRu: 'Профилактический контроль',
  controlPeriodKz: `${record.date.slice(0, 4)} жыл`, controlPeriodRu: `${record.date.slice(0, 4)} год`,
  publishedAt: `${record.date.slice(0, 4)}-01-01`, controlTypeKz: 'Субъектіге бару арқылы профилактикалық бақылау', controlTypeRu: 'Профилактический контроль с посещением субъекта',
  notificationNumber: `УВ-${record.id}`, notificationDate: record.date,
  requirements, findings: requirements.reduce((sum, item) => sum + item.found, 0),
  resolvedFindings: requirements.reduce((sum, item) => sum + item.resolved, 0),
  findingsDescription: requirements.some(item => item.found) ? 'Учебные нарушения требований проверочного листа' : 'Нарушений не установлено',
  measuresDescription: planState === 'completed' ? 'Подтверждено устранение учебных нарушений' : 'Контроль исполнения предписания', remarks: 'Учебная запись',
  financialCount, financialResolvedCount: planState === 'completed' ? financialCount : 0,
  proceduralResolvedCount: planState === 'completed' ? record.procedureCount : 0,
  dueBudget, dueEnterprise, dueAccounting: amount(record.financial - dueBudget - dueEnterprise),
  executedBudget, executedEnterprise, executedAccounting: amount(record.restored - executedBudget - executedEnterprise),
  proceduralResolved: amount(record.procedural * (planState === 'completed' ? 1 : .25)),
  orderNumber: record.orders ? `ПР-${record.id}` : 'Не выносилось', orderDate: record.orders ? record.date : null,
  responseNumber: record.executed ? `ОТВ-${record.id}` : 'Не поступал', responseDate: record.executed ? record.date : null,
  extendedDeadline: null, extensionLetterNumber: 'Не продлевалось',
  orderCount: record.orders, executedOrderCount: record.executed,
  administrative: {
   applied: adminApplied, basis: 'ст. 250 КоАП (учебный пример)',
   protocol: adminApplied ? `УЧ-ПРТ-${record.id} от ${record.date}` : 'Не составлялся',
   decision: adminApplied ? `УЧ-ПСТ-${record.id} от ${record.date}` : 'Не выносилось',
   fine: adminApplied ? 10000 + index * 500 : 0, paid: adminApplied ? 5000 + index * 250 : 0,
   receipt: adminApplied ? `УЧ-КВ-${record.id}` : 'Не применимо', executor: `Учебный исполнитель ${index % 6 + 1}`
  }
 };
}

const current = records.filter(record => record.module === 'ПРОФ');
export const professionalDemoFacts = Object.fromEntries(current.map((record, index) => [record.id, fixture(record, index)]));

// A separate illustrative comparison population; it never alters data.js or
// financial observations in custom inputs. All monetary values remain тыс. тг.
export const professionalPreviousRecords = current.slice(0, 20).map((record, index) => {
 const previous = {...record, id: record.id.replace('2026', '2025'), date: record.date.replace('2026', '2025'),
  month: record.month.replace('2026', '2025'), deadline: record.deadline?.replace('2026', '2025'),
  financial: amount(record.financial * .8), procedural: amount(record.procedural * .8),
  coverage: amount(record.coverage * .8), due: amount(record.due * .8), restored: amount(record.restored * .8)};
 return {...previous, professional: fixture(previous, index)};
});
