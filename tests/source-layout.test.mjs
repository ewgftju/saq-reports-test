import test from 'node:test';
import assert from 'node:assert/strict';
import {archiveForms} from '../form-registry.js';
import {generateArchiveReport} from '../archive-engine.js';
import {exportArchiveXlsx} from '../export.js';

// Inspect the actual ZIP/XML, not the intermediate report model. A separate
// scripts/verify-source-layout.py compares against private supplied workbooks
// without copying any source observations into this repository.
function unzip(bytes){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),decode=new TextDecoder(),files={};
 for(let offset=0;offset+30<=bytes.length&&view.getUint32(offset,true)===0x04034b50;){
  assert.equal(view.getUint16(offset+8,true),0,'Test expects the application ZIP store method');
  const size=view.getUint32(offset+18,true),names=view.getUint16(offset+26,true),extra=view.getUint16(offset+28,true),start=offset+30+names+extra;
  files[decode.decode(bytes.slice(offset+30,offset+30+names))]=decode.decode(bytes.slice(start,start+size));offset=start+size;
 }
 return files;
}
const decode=text=>text.replace(/&(amp|lt|gt|quot|apos);/g,(_,key)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[key]));
const numberAttribute=(text,name,fallback=0)=>Number(text.match(new RegExp(`\\b${name}="(\\d+)"`))?.[1]??fallback);
function assertTableFonts(files){
 const styles=files['xl/styles.xml'];
 const fonts=[...styles.match(/<fonts\b[^>]*>([\s\S]*?)<\/fonts>/)[1].matchAll(/<font\b[^>]*>([\s\S]*?)<\/font>/g)].map(match=>decode(match[1].match(/<name\b[^>]*val="([^"]+)"/)?.[1]||''));
 const xfs=[...styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)[1].matchAll(/<xf\b([^>]*)(?:\/>|>)/g)].map(match=>numberAttribute(match[1],'fontId'));
 for(const [name,xml] of Object.entries(files).filter(([path])=>/^xl\/worksheets\//.test(path)))
  for(const cell of xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)){
   if(!/<v>|<t(?:\s|>)/.test(cell[2]))continue;
   assert.equal(fonts[xfs[numberAttribute(cell[1],'s')]],'Times New Roman',`${name}: table cell must use Times New Roman`);
  }
}

test('full exports contain only original report worksheets and use Times New Roman',()=>{
 const supplied=archiveForms.filter(form=>['received','professional'].includes(form.engine));
 assert.equal(supplied.length,12);
 for(const form of supplied){
  const files=unzip(exportArchiveXlsx(generateArchiveReport(form.id)));
  const names=[...files['xl/workbook.xml'].matchAll(/<sheet\b[^>]*name="([^"]+)"/g)].map(match=>decode(match[1]));
  assert.equal(names.length,1,`${form.id}: source report contains one worksheet`);
  assert.doesNotMatch(names.join('|'),/Параметры|Основания КоАП/);
  assert.equal(names[0],form.sheets[0].sourceSheetName||form.sheets[0].name,`${form.id}: source worksheet name`);
  assertTableFonts(files);
 }
});

test('selected-column exports also omit technical worksheets and keep the requested fields only',()=>{
 const form=archiveForms.find(form=>form.id==='received-plan-detail'),result=generateArchiveReport(form.id);
 const selected=result.sheets[0].columns.slice(0,2).map(column=>`${result.sheets[0].id}:${column.id}`);
 const files=unzip(exportArchiveXlsx(result,selected));
 assert.equal((files['xl/workbook.xml'].match(/<sheet\b/g)||[]).length,1);
 assert.match(files['xl/worksheets/sheet1.xml'],/<dimension ref="A1:B\d+"/);
 assertTableFonts(files);
});
