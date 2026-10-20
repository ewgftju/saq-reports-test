import test from 'node:test';
import assert from 'node:assert/strict';
import {departments,departmentReports,catalogReports,catalogStatus,filterCatalog} from '../catalog.js';
import {catalogDetail,renderCatalogResults} from '../catalog-view.js';
import {reports} from '../data.js';

test('customer register retains ten departments and 72 numbered positions without losing existing reports',()=>{
 assert.equal(departments.length,10);assert.equal(departmentReports.length,72);
 assert.equal(new Set(catalogReports.map(r=>r.id)).size,catalogReports.length);
 assert.deepEqual(departments.map(d=>departmentReports.filter(r=>r.departmentId===d.id).length),[3,2,3,1,3,19,24,2,5,10]);
 for(const d of departments){const group=departmentReports.filter(r=>r.departmentId===d.id);assert.deepEqual(group.map(r=>r.number),Array.from({length:group.length},(_,i)=>i+1));}
 assert.deepEqual(catalogReports.filter(r=>r.reportId).map(r=>r.reportId).sort(),reports.map(r=>r.id).sort());
 for(const [number,reportId] of [[6,'abp'],[7,'vga'],[8,'org'],[20,'ega']])assert.equal(departmentReports.find(r=>r.id===`uao-${number.toString().padStart(2,'0')}`).reportId,reportId);
 assert.deepEqual(catalogReports.filter(r=>r.departmentId==='additional').map(r=>r.reportId),['sur','sva','prof','objections']);
});

test('archive metadata distinguishes full forms, references, missing files and unresolved duplicates',()=>{
 const uao=filterCatalog({department:'uao'});
 assert.equal(new Set(uao.flatMap(r=>r.files)).size,29);
 assert.equal(uao.filter(r=>r.material==='form').length,18);
 for(const number of [1,2,3])assert.equal(catalogStatus(uao.find(r=>r.number===number)),'reference');
 for(const number of [5,23,24])assert.equal(catalogStatus(uao.find(r=>r.number===number)),'missing');
 assert.equal(departmentReports.filter(r=>r.departmentId!=='uao').flatMap(r=>r.files).length,0);
 for(const number of [2,3,4])assert.equal(catalogStatus(departmentReports.find(r=>r.id===`coordination-0${number}`)),'clarify');
 assert.match(catalogDetail('uao-07').body,/расширенная редакция/);
 assert.match(catalogDetail('uao-01').body,/самой таблицы отчета в архиве нет/);
 assert.match(catalogDetail('uao-21').body,/форма остатка.xlsx/);
 assert.match(catalogDetail('uao-21').body,/форма по остатку 2.xlsx/);
});

test('catalog combines department, status and normalized search across customer titles and archive paths',()=>{
 assert.equal(filterCatalog().length,76);assert.equal(filterCatalog({status:'available'}).length,8);
 assert.equal(filterCatalog({department:'uao',status:'available'}).length,4);
 assert.deepEqual(filterCatalog({search:'  УаО  ПРИЛОЖЕНИЕ 3 АП0731173356  '}).map(r=>r.id),['uao-09']);
 assert.deepEqual(filterCatalog({search:'Отчет_по_видам_нарушений'}).map(r=>r.id),['uao-10']);
 assert.equal(filterCatalog({department:'legal',search:'бухгалтерского'}).length,0);
 assert.equal(filterCatalog({search:'неттакогоотчета'}).length,0);
});

test('only implemented reports expose generation, others open honest source details',()=>{
 const html=renderCatalogResults({department:'all'});
 assert.equal((html.match(/data-action="open-report"/g)||[]).length,8);
 assert.doesNotMatch(html,/report-card|report-grid/);
 assert.match(html,/Управление камерального контроля/);
 for(const r of catalogReports){const detail=catalogDetail(r.id);assert.equal(detail.reportId,r.reportId);assert.ok(detail.body);}
 assert.match(catalogDetail('uao-14').body,/Автоматическое формирование этой формы пока не реализовано/);
 assert.match(catalogDetail('extra-sva').body,/управление не назначено/);
 assert.equal(catalogDetail('unknown'),null);
});
