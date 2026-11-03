#!/usr/bin/env python3
"""Read-only source audit of four real application XLSX exports.

The existing application exporter writes scratch files; openpyxl reads only.
Usage: python scripts/verify-financial-audit-layout.py --source /private/upload \
       --output /scratch/financial-audit-layout
Private example rows are neither copied nor printed.
"""
from pathlib import Path
import argparse
import importlib.util
import json
import os
import subprocess

import openpyxl
from openpyxl.utils.cell import get_column_letter, range_boundaries


SPECS = [
    ('financial-audit-approvals','Таблица 3.xlsx',9,10,2,None),
    ('financial-audit-results','Таблица 2.xlsx',13,3,2,None),
    ('financial-audit-transfers','отчет передача 3.xlsx',13,51,2,(3,24)),
    ('financial-audit-administrative','Учет АДМ 1.xlsx',13,21,4,None),
]


def helper_module():
    spec = importlib.util.spec_from_file_location('base_layout_audit',Path(__file__).with_name('verify-source-layout.py'))
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    return helper


def compare(helper, original, actual, spec):
    ident, _, width, height, prefix, fixed = spec
    errors = []
    def check(condition,message):
        if not condition:
            errors.append(message)
    check(actual.max_column == width,'original meaningful columns')
    check(actual.max_row == height,'original row extent / minimum data slot')
    check(actual.freeze_panes is None,'unexpected frozen panes')
    check({str(m) for m in actual.merged_cells.ranges} ==
          {str(m) for m in original.merged_cells.ranges if range_boundaries(str(m))[2] <= width},'original merged cells')
    for col in range(1,width+1):
        expected,got = helper.output_width(original,col),helper.output_width(actual,col)
        if expected is not None:
            check(got is not None and abs(got-expected)<.01,f'{get_column_letter(col)} width')
    for row in range(1,min(height,original.max_row)+1):
        od,ad = original.row_dimensions.get(row),actual.row_dimensions.get(row)
        expected = od.height if od and od.height is not None else original.sheet_format.defaultRowHeight
        got = ad.height if ad and ad.height is not None else actual.sheet_format.defaultRowHeight
        if expected is not None:
            check(got is not None and abs(got-expected)<.01,f'row {row} height')
    structural = {(r,c) for r in range(1,prefix+1) for c in range(1,width+1)}
    if fixed:
        structural.update((r,c) for r in range(fixed[0],fixed[1]+1) for c in (1,2))
    dynamic = {'A2'} if ident.endswith('administrative') else set()
    if ident.endswith('administrative'):
        structural.add((10,1))
    for row,col in sorted(structural):
        ref = f'{get_column_letter(col)}{row}'
        source,target = original.cell(row,col),actual.cell(row,col)
        if ref in dynamic:
            check(isinstance(target.value,str) and bool(target.value.strip()),f'{ref} organ caption')
        else:
            check(helper.canonical(source.value)==helper.canonical(target.value),f'{ref} source text')
        if helper.canonical(source.value) != '':
            es,gs = helper.cell_style(source),helper.cell_style(target)
            for key in es:
                check(es[key]==gs[key],f'{ref} style.{key}')
    for row in actual:
        for cell in row:
            check(cell.font.name=='Times New Roman',f'{cell.coordinate} font')
            if cell.value is None:
                continue
            check(cell.data_type not in ('f','e'),f'{cell.coordinate} copied formula or Excel error')
            # Numbering in empty administrative slots is allowed; source sample
            # people, dates and values are not part of the template structure.
            ordinal = ident.endswith('administrative') and cell.column==1 and 5<=cell.row<=9 and cell.value==cell.row-4
            check((cell.row,cell.column) in structural or ordinal,f'{cell.coordinate} populated empty-export body')
    for key in helper.PAGE_FIELDS:
        expected,got = getattr(original.page_setup,key),getattr(actual.page_setup,key)
        check(expected==got,f'pageSetup.{key}')
    for key in helper.MARGIN_FIELDS:
        expected,got = getattr(original.page_margins,key),getattr(actual.page_margins,key)
        check(expected==got or (expected is not None and got is not None and abs(expected-got)<1e-8),f'pageMargins.{key}')
    check(str(actual.print_area)==str(original.print_area),'print area')
    check(actual.print_title_rows==original.print_title_rows,'print title rows')
    check(actual.print_title_cols==original.print_title_cols,'print title columns')
    return list(dict.fromkeys(errors))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[1]
    args.output.mkdir(parents=True,exist_ok=True)
    code = """
import {writeFile} from 'node:fs/promises';
import {generateArchiveReport} from './archive-engine.js';
import {exportArchiveXlsx} from './export.js';
for (const suffix of ['approvals','results','transfers','administrative']) {
 const id=`financial-audit-${suffix}`;
 await writeFile(`${process.argv[1]}/${id}-empty.xlsx`,exportArchiveXlsx(generateArchiveReport(id,undefined,[])));
 await writeFile(`${process.argv[1]}/${id}-demo.xlsx`,exportArchiveXlsx(generateArchiveReport(id)));
}
"""
    subprocess.run([os.environ.get('CODEX_PRIMARY_RUNTIME_NODE','node'),'--input-type=module','-e',code,str(args.output.resolve())],cwd=repo,check=True)
    helper = helper_module()
    reports = []
    source_admin = openpyxl.load_workbook(args.source/'Учет АДМ 1.xlsx',data_only=False).active
    private_examples = [source_admin[ref].value for ref in ['B5','B6'] if isinstance(source_admin[ref].value,str)]
    source_strings = [p.read_text(errors='replace') for p in repo.glob('*.js')]
    for spec in SPECS:
        ident,filename,width,_,_,_ = spec
        source = openpyxl.load_workbook(args.source/filename,data_only=False)
        empty = openpyxl.load_workbook(args.output/f'{ident}-empty.xlsx',data_only=False)
        demo = openpyxl.load_workbook(args.output/f'{ident}-demo.xlsx',data_only=False)
        errors = []
        if empty.sheetnames!=source.sheetnames or demo.sheetnames!=source.sheetnames:
            errors.append('original sheet names/order/count')
        errors.extend(compare(helper,source.worksheets[0],empty.worksheets[0],spec))
        ds = demo.worksheets[0]
        if ds.max_column!=width:
            errors.append('demo extra/missing fields')
        if ds.freeze_panes is not None:
            errors.append('demo frozen panes')
        values = []
        for row in ds:
            for cell in row:
                if cell.value is None:
                    continue
                values.append(str(cell.value))
                if cell.font.name!='Times New Roman':
                    errors.append(f'demo {cell.coordinate} font')
                if cell.data_type in ('f','e'):
                    errors.append(f'demo {cell.coordinate} formula/error')
        if any(any(private in text for text in source_strings+values) for private in private_examples):
            errors.append('private sample text found in code/export')
        reports.append({'form':ident,'sheets':empty.sheetnames,'errors':list(dict.fromkeys(errors))})
    failures = sum(len(result['errors']) for result in reports)
    print(json.dumps({'reports':reports,'failures':failures},ensure_ascii=False))
    raise SystemExit(bool(failures))


if __name__=='__main__':
    main()
