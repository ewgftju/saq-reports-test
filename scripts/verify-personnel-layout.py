#!/usr/bin/env python3
"""Compare actual staff-report exports against the private source, read-only.

Usage: python scripts/verify-personnel-layout.py --source '/private/список КВГА.xlsx' \
       --output /scratch/personnel-layout-audit
The application creates the XLSX files; openpyxl only reads them.
"""
from pathlib import Path
import argparse
import importlib.util
import json
import os
import subprocess

import openpyxl
from openpyxl.utils.cell import get_column_letter, range_boundaries


SECTION_ROWS = [5,14,28,39,50,62,79,92,102,123,145,160]


def helper_module():
    spec = importlib.util.spec_from_file_location('base_layout_audit',Path(__file__).with_name('verify-source-layout.py'))
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    return helper


def check_book(helper, original, book, mode):
    errors=[]
    def check(condition,label):
        if not condition:
            errors.append(label)
    check(book.sheetnames==['Лист1'],'original worksheet names/count')
    actual=book.worksheets[0]
    shift=2 if mode=='overflow' else 0
    def moved(row):
        return row+shift if row>10 else row
    check(actual.max_column==5,'four fields plus original blank left margin')
    check(actual.max_row==174+shift,'original row extent and necessary expansion')
    check(actual.freeze_panes is None,'frozen panes')
    expected_merges=set()
    for merge in original.merged_cells.ranges:
        c1,r1,c2,r2=range_boundaries(str(merge))
        expected_merges.add(f'{get_column_letter(c1)}{moved(r1)}:{get_column_letter(c2)}{moved(r2)}')
    check({str(m) for m in actual.merged_cells.ranges}==expected_merges,'original merged ranges and shifts')
    for column in range(1,6):
        expected,got=helper.output_width(original,column),helper.output_width(actual,column)
        check(expected==got or expected is not None and got is not None and abs(expected-got)<.01,
              f'{get_column_letter(column)} width')
    for row in range(1,175):
        source_dim,target_dim=original.row_dimensions.get(row),actual.row_dimensions.get(moved(row))
        expected=source_dim.height if source_dim and source_dim.height is not None else original.sheet_format.defaultRowHeight
        got=target_dim.height if target_dim and target_dim.height is not None else actual.sheet_format.defaultRowHeight
        check(expected==got or expected is not None and got is not None and abs(expected-got)<.01,f'row {row} height')
        for column in range(1,6):
            source,target=original.cell(row,column),actual.cell(moved(row),column)
            # Source headings, section names and empty geometry must remain;
            # numbers and populated staff fields are runtime values.
            dynamic=mode!='empty' and ((column==2 and isinstance(source.value,int)) or column in (3,4,5) and row>1)
            if not dynamic:
                check(source.value==target.value,f'{source.coordinate} original literal')
            es,gs=helper.cell_style(source),helper.cell_style(target)
            for key in es:
                check(es[key]==gs[key],f'{source.coordinate} style.{key}')
    for row in actual:
        for cell in row:
            check(cell.font.name=='Times New Roman',f'{cell.coordinate} font')
            check(cell.data_type not in ('f','e'),f'{cell.coordinate} formula/error')
    for key in helper.PAGE_FIELDS:
        check(getattr(original.page_setup,key)==getattr(actual.page_setup,key),f'pageSetup.{key}')
    for key in helper.MARGIN_FIELDS:
        expected,got=getattr(original.page_margins,key),getattr(actual.page_margins,key)
        check(expected==got or expected is not None and got is not None and abs(expected-got)<1e-8,f'pageMargins.{key}')
    check(str(original.print_area)==str(actual.print_area),'print area')
    check(original.print_title_rows==actual.print_title_rows,'print title rows')
    check(original.print_title_cols==actual.print_title_cols,'print title cols')
    if mode=='empty':
        check(actual['B74'].value==50 and actual['B88'].value==actual['B93'].value==60,'original numbering anomalies retained in empty template')
    else:
        numbers=[cell.value for row in actual for cell in row if cell.column==2 and isinstance(cell.value,int)]
        check(numbers==list(range(1,118+shift)),'generated consecutive slot numbers')
        expected_rows={6:('Учебный руководитель','Учебный сотрудник 1','Учебное примечание'),
                       15:('Учебный эксперт','Учебный сотрудник 2',''),
                       161:('Учебный специалист','Учебный сотрудник 3','')} if mode=='populated' else {
                       **{r:('Учебная должность',f'Учебный сотрудник {r-5}','') for r in range(6,13)},
                       17:('Учебный эксперт','Учебный сотрудник 8','')}
        for row in actual:
            for cell in row:
                if cell.column not in (3,4,5) or cell.row==1 or cell.value is None:
                    continue
                wanted=expected_rows.get(cell.row)
                check(wanted is not None and cell.value==wanted[cell.column-3],f'{cell.coordinate} unexpected staff data')
        for row,expected in expected_rows.items():
            for column,value in zip((3,4,5),expected):
                check((actual.cell(row,column).value or '')==value,f'{get_column_letter(column)}{row} generated staff value')
    return list(dict.fromkeys(errors))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    repo=Path(__file__).resolve().parents[1]
    args.output.mkdir(parents=True,exist_ok=True)
    code="""
import {writeFile} from 'node:fs/promises';
import {generateArchiveReport} from './archive-engine.js';
import {exportArchiveXlsx} from './export.js';
const staff=(id,sectionId,position,fullName,note='')=>({id,sectionId,position,fullName,note,startDate:'2026-01-01',endDate:null});
const sets={empty:[],populated:[staff('one','leadership','Учебный руководитель','Учебный сотрудник 1','Учебное примечание'),
 staff('two','personnel','Учебный эксперт','Учебный сотрудник 2'),staff('three','audit-cooperation','Учебный специалист','Учебный сотрудник 3')],
 overflow:[...Array.from({length:7},(_,i)=>staff(`leader-${i}`,'leadership','Учебная должность',`Учебный сотрудник ${i+1}`)),
 staff('hr','personnel','Учебный эксперт','Учебный сотрудник 8')]};
for(const [name,source] of Object.entries(sets)){
 const report=generateArchiveReport('personnel-kvga-staff',{to:'2026-11-04'},source);
 await writeFile(`${process.argv[1]}/personnel-${name}.xlsx`,exportArchiveXlsx(report));
}
"""
    subprocess.run([os.environ.get('CODEX_PRIMARY_RUNTIME_NODE','node'),'--input-type=module','-e',code,str(args.output.resolve())],cwd=repo,check=True)
    original=openpyxl.load_workbook(args.source,data_only=False)
    if original.sheetnames!=['Лист1']:
        raise ValueError('Unexpected source sheet list; review the template.')
    helper=helper_module()
    results=[]
    for mode in ('empty','populated','overflow'):
        book=openpyxl.load_workbook(args.output/f'personnel-{mode}.xlsx',data_only=False)
        results.append({'case':mode,'errors':check_book(helper,original['Лист1'],book,mode)})
    failures=sum(len(result['errors']) for result in results)
    print(json.dumps({'sourceSheets':original.sheetnames,'cases':results,'failures':failures},ensure_ascii=False))
    raise SystemExit(bool(failures))


if __name__=='__main__':
    main()
