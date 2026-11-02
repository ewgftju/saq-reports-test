#!/usr/bin/env python3
"""Extract the two SVA plan forms supplied on 02.11.2026.

Read-only xlrd/openpyxl extraction. Only source captions, column headings,
numbering and the fixed institution labels are allowlisted. Observations,
formula caches, signatures, comments and hyperlinks are never published.
The shared layout reader normalizes Excel fonts to Times New Roman.
"""
import argparse
import importlib.util
import json
from pathlib import Path

import openpyxl
import xlrd
from openpyxl.utils.cell import get_column_letter, range_boundaries

DETAIL_FILE = 'Информация исполнению перечня отчеты ДВГА (1).xls'
MONITORING_FILE = 'Информация по исполнению Перечня (1).xlsx'

# Stable identities shared with cooperation-schemas.js, matched by institution,
# not by row/ordinal: the order differs between the two supplied workbooks.
GROUPS = [
    ('ЦГО', 'cgo', 12, 41, 42,
     [1, 3, 2, 4, 5, 6, 8, 18, 9, 10, 11, 12, 13, 15, 17, 14, 16, 7, 19, 20,
      21, 23, 24, 22, 25, 29, 30, 26, 27, 28]),
    ('МИО', 'mio', 43, 62, 63, list(range(1, 21))),
    ('ДП', 'dp', 64, 77, 78, [1, 9, 10, 18, 12, 14, 17, 19, 5, 3, 11, 7, 16, 4]),
]


def headers(layout, first, last):
    """Relative header coordinates for the existing preview/export selector."""
    cells = {}
    for column in range(1, layout['columnCount'] + 1):
        letter = get_column_letter(column)
        for row in range(first, last + 1):
            value = layout['cells'].get(f'{letter}{row}')
            if value is not None and (not isinstance(value, str) or value.strip()):
                cells[f'{letter}{row - first + 1}'] = value
    merges = []
    for reference in layout['merges']:
        c1, r1, c2, r2 = range_boundaries(reference)
        if first <= r1 <= r2 <= last:
            merges.append(f'{get_column_letter(c1)}{r1-first+1}:{get_column_letter(c2)}{r2-first+1}')
    columns = []
    for column in range(1, layout['columnCount'] + 1):
        labels = []
        for row in range(1, last - first + 2):
            value = cells.get(f'{get_column_letter(column)}{row}')
            if value is None:
                for reference in merges:
                    c1, r1, c2, r2 = range_boundaries(reference)
                    if c1 <= column <= c2 and r1 <= row <= r2:
                        value = cells.get(f'{get_column_letter(c1)}{r1}')
                        break
            if value is not None and str(value) not in labels:
                labels.append(str(value))
        columns.append({'letter': get_column_letter(column), 'labels': labels})
    return {'columnCount': layout['columnCount'], 'headerDepth': last - first + 1,
            'sourceHeaderRows': [first, last], 'headerCells': cells,
            'merges': sorted(merges), 'columns': columns}


def detail(path, extract):
    book = xlrd.open_workbook(path, formatting_info=True)
    assert book.sheet_names() == ['СВА ЦГО', 'СВА МИО'], 'Review changed source sheets.'
    sheets = []
    for name, key, category in [('СВА ЦГО', 'cgo', 'ЦГО'), ('СВА МИО', 'mio', 'МИО')]:
        source = book.sheet_by_name(name)
        assert (source.nrows, source.ncols) == (13, 14), 'Review changed detail grid.'
        allowed = [f'{get_column_letter(c)}{r}' for r in range(1, 9) for c in range(1, 15)] + ['B12']
        layout = extract(path, sheet_name=name, column_count=14, row_count=13, allowed_cells=allowed)
        assert layout['cells']['B12'] == 'Итого ', 'Review changed total row.'
        sheets.append({'id': f'cooperation-plan-detail-{key}', 'key': key, 'category': category,
                       'name': name, 'sourceSheetName': name, 'kind': 'table',
                       **headers(layout, 6, 7), 'templateLayout': layout,
                       'sourcePlacement': {'prefixEnd': 8, 'dataStart': 9, 'dataEnd': 11,
                                           'totalRow': 12, 'labelColumns': ['B']}})
    return sheets


def monitoring(path, extract):
    book = openpyxl.load_workbook(path, data_only=False)
    assert book.sheetnames == ['лист'], 'Review changed source sheets.'
    source = book['лист']
    assert str(source.print_area) == "'лист'!$A$1:$AB$89", 'Review changed print area.'
    # The eight physical columns after AB contain whitespace only. They are
    # outside the source print area and are not report fields.
    assert all(cell.value is None or isinstance(cell.value, str) and not cell.value.strip()
               for row in source.iter_rows(min_col=29) for cell in row), 'Review content outside source print area.'
    allowed = [f'{get_column_letter(c)}{r}' for r in range(1, 12) for c in range(1, 29)]
    allowed += [f'{c}{r}' for r in range(12, 80) for c in ['B', 'C']]
    layout = extract(path, sheet_name='лист', column_count=28, row_count=89, allowed_cells=allowed)
    data_rows, total_rows = [], []
    for category, key, first, last, total, ids in GROUPS:
        for ordinal, (row, identity) in enumerate(zip(range(first, last + 1), ids), 1):
            assert layout['cells'][f'B{row}'] == ordinal, 'Review changed institution numbering.'
            label = layout['cells'][f'C{row}']
            assert isinstance(label, str) and label.strip(), 'Missing institution label.'
            data_rows.append({'id': f'{key}-{identity:02d}', 'key': key, 'category': category,
                              'sourceRow': row, 'ordinal': ordinal, 'label': label,
                              'labelCell': f'C{row}', 'ordinalCell': f'B{row}'})
        total_rows.append({'id': f'{key}-total', 'key': f'{key}-total', 'category': category,
                           'sourceRow': total, 'label': layout['cells'][f'B{total}'],
                           'labelCell': f'B{total}', 'fromRow': first, 'toRow': last})
    total_rows.append({'id': 'overall-total', 'key': 'overall-total', 'category': 'all',
                       'sourceRow': 79, 'label': layout['cells']['B79'], 'labelCell': 'B79'})
    return [{'id': 'cooperation-plan-monitoring-s1', 'key': 'monitoring', 'name': 'лист',
             'sourceSheetName': 'лист', 'kind': 'institution-summary', **headers(layout, 8, 10),
             'templateLayout': layout, 'dataRows': data_rows, 'totalRows': total_rows,
             'sourcePlacement': {'prefixEnd': 11, 'bodyStart': 12, 'bodyEnd': 79,
                                 'labelColumns': ['B', 'C']}}]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', type=Path, default=Path('cooperation-plan-schemas.js'))
    args = parser.parse_args()
    spec = importlib.util.spec_from_file_location('source_layout', Path(__file__).with_name('source-layout.py'))
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    common = {'departmentId': 'audit-cooperation', 'catalogNumber': 9,
              'sources': ['СВА'], 'engine': 'cooperation-plan'}
    forms = [
        {'id': 'cooperation-plan-detail',
         'name': 'Исполнение Перечня объектов государственного аудита — СВА ЦГО и МИО',
         'sourceFile': DETAIL_FILE, **common,
         'sheets': detail(args.source / DETAIL_FILE, helper.extract_source_layout)},
        {'id': 'cooperation-plan-monitoring',
         'name': 'Мониторинг исполнения Перечня — СВА ЦГО, МИО и ДП',
         'sourceFile': MONITORING_FILE, **common,
         'sheets': monitoring(args.source / MONITORING_FILE, helper.extract_source_layout)},
    ]
    args.output.write_text('// Original source structure only. Customer observations, formula caches, signatures and external links are excluded.\nexport const cooperationPlanForms = '
                          + json.dumps(forms, ensure_ascii=False, separators=(',', ':')) + ';\n')
    print(json.dumps([{'id': form['id'], 'sheets': [{'name': sheet['name'],
                        'rows': sheet['templateLayout']['rowCount'], 'columns': sheet['columnCount']}
                       for sheet in form['sheets']]} for form in forms], ensure_ascii=False))


if __name__ == '__main__':
    main()
