#!/usr/bin/env python3
"""Independently compare real application exports with the two private templates.

The application writes scratch XLSX exports; openpyxl/xlrd only read files.
Run: python scripts/verify-cooperation-plan-layout.py --source /private/upload \
     --output /scratch/plan-layout-audit
"""
from pathlib import Path
import argparse
import importlib.util
import json
import os
import struct
import subprocess

import openpyxl
from openpyxl.utils.cell import get_column_letter, range_boundaries


def helper_module():
    path = Path(__file__).with_name('verify-source-layout.py')
    spec = importlib.util.spec_from_file_location('existing_layout_audit', path)
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    return helper


def source_sheet(helper, path, index):
    source = helper.Source(path)
    source.sheet = source.book.sheet_by_index(index) if source.xls else source.book.worksheets[index]
    if source.xls:
        source.max_column = source.sheet.ncols
        source.merges = {f'{get_column_letter(c+1)}{r+1}:{get_column_letter(cc)}{rr}'
                         for r, rr, c, cc in source.sheet.merged_cells}
    else:
        source.max_column = source.sheet.max_column
        source.merges = {str(m) for m in source.sheet.merged_cells.ranges}
    return source


def source_page(source, index):
    if not source.xls:
        return source.page()
    # Select the actual sheet's BIFF stream; no extractor metadata is trusted.
    from xlrd.compdoc import CompDoc
    compound = CompDoc(source.path.read_bytes())
    data = compound.get_named_stream('Workbook') or compound.get_named_stream('Book')
    pos = source.book._sh_abs_posn[index] - source.book.base
    setup, margins = {}, {}
    while pos + 4 <= len(data):
        opcode, length = struct.unpack_from('<HH', data, pos)
        chunk = data[pos+4:pos+4+length]
        pos += length + 4
        if opcode == 0x000A:
            break
        if opcode in (0x26, 0x27, 0x28, 0x29):
            margins[('left','right','top','bottom')[opcode-0x26]] = struct.unpack_from('<d', chunk)[0]
        if opcode == 0xA1 and length >= 34:
            paper, scale, first, width, height, flags, hdpi, vdpi, header, footer, _ = struct.unpack_from('<8H2dH', chunk)
            setup = {'paperSize':paper, 'scale':scale, 'firstPageNumber':first, 'fitToWidth':width,
                     'fitToHeight':height, 'orientation':'portrait' if flags & 2 else 'landscape',
                     'blackAndWhite':bool(flags & 8), 'draft':bool(flags & 16),
                     'useFirstPageNumber':bool(flags & 128), 'pageOrder':'overThenDown' if flags & 1 else 'downThenOver',
                     'horizontalDpi':hdpi, 'verticalDpi':vdpi}
            margins.update(header=header, footer=footer)
    return setup, margins


def compare(helper, source, actual, index, detail):
    errors = []
    def check(condition, description):
        if not condition:
            errors.append(description)
    width, height, prefix = (14,13,8) if detail else (28,89,11)
    check(actual.max_column == width, 'original table column extent')
    check(actual.max_row == height, 'original row extent')
    original_merges = {ref for ref in source.merges if range_boundaries(ref)[2] <= width}
    check({str(m) for m in actual.merged_cells.ranges} == original_merges, 'original merges')
    check(actual.freeze_panes is None, 'frozen panes unexpectedly present')
    for column in range(1, width+1):
        expected, got = source.explicit_width(column), helper.output_width(actual, column)
        if expected is not None:
            check(got is not None and abs(got-expected) < .01, f'{get_column_letter(column)} column width')
    for row in range(1, height+1):
        expected = source.row_height(row)
        dimension = actual.row_dimensions.get(row)
        got = dimension.height if dimension and dimension.height is not None else actual.sheet_format.defaultRowHeight
        if expected is not None:
            check(got is not None and abs(got-expected) < .01, f'row {row} height')
    structural = {(r,c) for r in range(1,prefix+1) for c in range(1,width+1)}
    structural.update({(12,2)} if detail else {(r,c) for r in range(12,80) for c in (2,3)})
    dynamic = {'A4'} if detail else {'B4','B6','D8'}
    for row, column in sorted(structural):
        ref = f'{get_column_letter(column)}{row}'
        original, exported = source.value(row,column), actual.cell(row,column).value
        if ref in dynamic:
            check(exported is not None and '2026' in str(exported), f'{ref} selected year')
        else:
            check(helper.canonical(original) == helper.canonical(exported), f'{ref} source label')
        if helper.canonical(original) != '':
            expected, got = source.style(row,column), helper.cell_style(actual.cell(row,column))
            for key in expected:
                check(expected[key] == got[key], f'{ref} style.{key}')
    for row in actual:
        for cell in row:
            check(cell.font.name == 'Times New Roman', f'{cell.coordinate} font')
            if cell.value is None:
                continue
            check(cell.data_type not in ('f','e'), f'{cell.coordinate} formula/error')
            # Empty-record exports may contain only source static content plus
            # the three intentionally parameterized date/year cells.
            check((cell.row,cell.column) in structural, f'{cell.coordinate} extra populated field')
    setup, margins = source_page(source,index)
    for key,value in setup.items():
        got = getattr(actual.page_setup,key)
        check(str(got) == str(value), f'pageSetup.{key}')
    for key,value in margins.items():
        got = getattr(actual.page_margins,key)
        check(got is not None and abs(got-value)<1e-8, f'pageMargins.{key}')
    if not source.xls:
        check(str(actual.print_area) == str(source.sheet.print_area), 'print area')
        check(actual.print_title_rows == source.sheet.print_title_rows, 'print title rows')
        check(actual.print_title_cols == source.sheet.print_title_cols, 'print title cols')
    return {'sheet':actual.title, 'errors':list(dict.fromkeys(errors))}


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
for (const id of ['cooperation-plan-detail','cooperation-plan-monitoring']) {
 await writeFile(`${process.argv[1]}/${id}.xlsx`, exportArchiveXlsx(generateArchiveReport(id, undefined, [])));
}
"""
    subprocess.run([os.environ.get('CODEX_PRIMARY_RUNTIME_NODE','node'),'--input-type=module','-e',code,str(args.output.resolve())],cwd=repo,check=True)
    helper = helper_module()
    results = []
    for ident, filename, detail in [
        ('cooperation-plan-detail','Информация исполнению перечня отчеты ДВГА (1).xls',True),
        ('cooperation-plan-monitoring','Информация по исполнению Перечня (1).xlsx',False),
    ]:
        source_path = args.source / filename
        source = helper.Source(source_path)
        actual = openpyxl.load_workbook(args.output / f'{ident}.xlsx',data_only=False)
        result = {'form':ident,'errors':[],'sheets':[]}
        if actual.sheetnames != source.names:
            result['errors'].append('source worksheet names/order/count differ')
        for index,sheet in enumerate(actual):
            result['sheets'].append(compare(helper,source_sheet(helper,source_path,index),sheet,index,detail))
        results.append(result)
    failures = sum(len(r['errors']) + sum(len(s['errors']) for s in r['sheets']) for r in results)
    print(json.dumps({'forms':results,'failures':failures},ensure_ascii=False))
    raise SystemExit(bool(failures))


if __name__ == '__main__':
    main()
