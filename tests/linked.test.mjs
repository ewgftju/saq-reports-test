import test from 'node:test';
import assert from 'node:assert/strict';
import {linkedFacts,joinAuditFacts,linkedDefaultColumns} from '../linked-data.js';
import {defaultFilters,records} from '../data.js';
import {generate,availableFields} from '../engine.js';
import {exportCsv} from '../export.js';
const config=()=>({name:'Связанные данные',dataset:'case-links',sources:['ВГА','СУР','Возражения'],filters:defaultFilters(),columns:[...linkedDefaultColumns],group:'none'});
test('two objections and three payments do not multiply violation amounts',()=>{
 const r=joinAuditFacts()[0];assert.equal(r.violationCount,2);assert.equal(r.objectionCount,2);assert.equal(r.financial,1500);assert.equal(r.restored,500);assert.equal(r.cancelled,200);assert.equal(r.balance,800);
});
test('two cases with the same BIN retain separate risk calculations and financial facts',()=>{
 const [a,b,c]=joinAuditFacts();assert.equal(a.bin,b.bin);assert.equal(a.score,85);assert.equal(b.score,55);assert.equal(b.financial,800);assert.equal(b.objectionCount,0);assert.equal(c.score,null);assert.equal(c.linkState,'Связь не задана');
});
test('fact and confirmation cutoff excludes pending, future and not yet confirmed entries',()=>{
 const [a,b]=joinAuditFacts(undefined,'2026-09-20');assert.equal(a.restored,500);assert.equal(a.cancelled,0);assert.equal(b.restored,0);
 const later=joinAuditFacts(undefined,'2026-10-06');assert.equal(later[0].restored,500);assert.equal(later[1].restored,150);
});
test('identical transport duplicates are counted once, conflicting versions rejected',()=>{
 const f=structuredClone(linkedFacts);f.executions.push({...f.executions[0]});f.objections.push({...f.objections[0]});assert.equal(joinAuditFacts(f)[0].restored,500);assert.equal(joinAuditFacts(f)[0].objectionCount,2);
 f.executions.push({...f.executions[0],amount:999});assert.throws(()=>joinAuditFacts(f),/Конфликт версий/);
});
test('wrong module, orphan executions and unrelated risk assessment never join by BIN alone',()=>{
 const f=structuredClone(linkedFacts);f.objections.push({id:'OTHER',caseId:f.cases[0].id,sourceModule:'СВА',date:'2026-09-01'});f.executions.push({id:'ORPHAN',violationId:'missing',amount:9999,date:'2026-09-01',confirmedAt:'2026-09-01',status:'Подтверждено'});f.assessments.push({id:'RISK-NEW',bin:f.cases[0].bin,date:'2026-09-01',score:99});
 const r=joinAuditFacts(f)[0];assert.equal(r.objectionCount,2);assert.equal(r.restored,500);assert.equal(r.score,85);
});
test('over-execution cannot silently produce a negative balance',()=>{
 const f=structuredClone(linkedFacts);f.executions[0].amount=2000;assert.throws(()=>joinAuditFacts(f),/превышают/);
});
test('builder filters and grouping use linked cases, distinguish missing risk and survive config snapshots',()=>{
 const c=config();const result=generate(records,c);assert.equal(result.recordCount,3);assert.equal(result.objectCount,2);assert.equal(result.rows[0].balance,800);
 c.group='region';c.columns=['region','count','financial','restored','cancelled','balance'];const grouped=generate(records,c);assert.equal(grouped.rows[0].financial,2300);assert.equal(grouped.rows[0].balance,1500);
 c.filters.query='VGA-LINK-002';assert.equal(generate(records,c).recordCount,1);c.filters.query='';c.filters.risk='Высокий';assert.equal(generate(records,c).recordCount,1);
 assert.equal(result.config.group,'none');assert.equal(availableFields(c.sources,'none').some(f=>f.id==='balance'),false);assert.equal(availableFields(c.sources,'none','case-links').some(f=>f.id==='balance'),true);
 assert.match(exportCsv(result),/Нет данных/);assert.doesNotMatch(exportCsv(result),/Не применимо/);
});
