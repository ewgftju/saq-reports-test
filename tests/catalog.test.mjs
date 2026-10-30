import test from 'node:test';
import assert from 'node:assert/strict';
import {departments,departmentReports,catalogReports,catalogStatus,filterCatalog} from '../catalog.js';
import {catalogDetail,renderCatalogResults} from '../catalog-view.js';
import {archiveForms,formDepartment} from '../form-registry.js';

test('customer register retains ten departments and 72 numbered positions',()=>{
 assert.equal(departments.length,10);assert.equal(departmentReports.length,72);
 assert.equal(new Set(catalogReports.map(r=>r.id)).size,catalogReports.length);
 assert.deepEqual(departments.map(d=>departmentReports.filter(r=>r.departmentId===d.id).length),[3,2,3,1,3,21,22,2,5,10]);
 for(const d of departments){const group=departmentReports.filter(r=>r.departmentId===d.id);assert.deepEqual(group.map(r=>r.number),d.id==='uao'?Array.from({length:24},(_,i)=>i+1).filter(n=>![11,16].includes(n)):Array.from({length:group.length},(_,i)=>i+1));}
 assert.deepEqual(catalogReports.filter(r=>r.departmentId==='additional').map(r=>r.reportId),['sur','sva','prof','objections']);
});

test('all 31 active Excel forms and their 38 sheets have a distinct generating catalog entry',()=>{
 assert.equal(archiveForms.length,31);assert.equal(archiveForms.reduce((n,f)=>n+f.sheets.length,0),38);
 const entries=catalogReports.filter(r=>r.archiveFormId);
 assert.equal(entries.length,31);
 assert.deepEqual(entries.map(r=>r.archiveFormId).sort(),archiveForms.map(f=>f.id).sort());
 assert.deepEqual(entries.map(r=>r.sourceFile).sort(),archiveForms.map(f=>f.sourceFile).sort());
 for(const r of entries){assert.equal(r.departmentId,formDepartment(archiveForms.find(f=>f.id===r.archiveFormId)));assert.equal(catalogStatus(r),'available');}
 assert.equal(entries.filter(r=>String(r.number).startsWith('4.')).length,2);
 assert.equal(entries.filter(r=>String(r.number).startsWith('15.')).length,2);
 assert.equal(entries.filter(r=>r.departmentId==='uao'&&String(r.number).startsWith('16.')).length,0);
 assert.equal(entries.filter(r=>String(r.number).startsWith('21.')).length,2);
 for(const number of [1,2,3,5,23,24])assert.equal(catalogStatus(catalogReports.find(r=>r.id===`uao-${String(number).padStart(2,'0')}`)),'listed');
});

test('catalog filters departments, availability and source filenames',()=>{
 assert.equal(filterCatalog().length,81);assert.equal(filterCatalog({status:'available'}).length,35);
 assert.equal(filterCatalog({department:'uao',status:'available'}).length,19);
 assert.deepEqual(filterCatalog({search:'  УаО  ПРИЛОЖЕНИЕ 3 АП0731173356  '}).map(r=>r.archiveFormId),['uao-administrative']);
 assert.deepEqual(filterCatalog({search:'Отчет_по_видам_нарушений'}).map(r=>r.archiveFormId),['uao-violation-types']);
 assert.equal(filterCatalog({department:'legal',search:'бухгалтерского'}).length,0);
 assert.equal(filterCatalog({search:'неттакогоотчета'}).length,0);
});

test('compact rows expose every Excel form without internal clarification notes',()=>{
 const html=renderCatalogResults({department:'all'});
 assert.equal((html.match(/data-action="open-archive"/g)||[]).length,62);
 assert.equal((html.match(/data-action="open-report"/g)||[]).length,8);
 assert.doesNotMatch(html,/report-card|report-grid|Нужно уточнение|расширенная редакция|data-action="catalog-details"/);
 assert.match(html,/Управление камерального контроля/);
 for(const r of catalogReports){const detail=catalogDetail(r.id);assert.equal(detail.reportId,r.reportId);assert.ok(detail.body);}
 assert.equal(catalogDetail('unknown'),null);
});


test('customer revision removes UAO 11/16 while keeping other department numbers and renames 23',()=>{
 const uao=filterCatalog({department:'uao'});
 assert.ok(uao.every(r=>![11,16].includes(Number(String(r.number).split('.')[0]))));
 assert.ok(departmentReports.some(r=>r.id==='coordination-11'));
 assert.ok(departmentReports.some(r=>r.id==='coordination-16'));
 const updated=uao.find(r=>r.number===23);
 assert.equal(updated.name,'Отчет по исполнению плана развития МФ на 2026-2030 годы');
 assert.equal(updated.sourceTitle,updated.name);
 assert.equal(filterCatalog({search:'2023–2027'}).length,0);
 assert.equal(filterCatalog({department:'digital-risks',status:'available'}).length,5);
 assert.equal(filterCatalog({department:'quality',status:'available'}).length,1);
 assert.equal(filterCatalog({department:'coordination',status:'available'}).length,6);
});
