#!/usr/bin/env python3
"""Extract the structural staff-list template supplied on 04.11.2026.

Usage: python scripts/extract-personnel-form.py '/path/to/список КВГА.xlsx'

openpyxl is used only for reading. The allowlist contains column headings,
section labels and the source slot numbering. Position titles, employee names
and notes are runtime data and are never copied from a supplied workbook.
"""
import argparse
import importlib.util
import json
from pathlib import Path

import openpyxl
from openpyxl.utils.cell import get_column_letter


FORM_ID = 'personnel-kvga-staff'
SECTIONS = [
    ('leadership', 5, 6, 10),
    ('personnel', 14, 15, 24),
    ('operations', 28, 29, 35),
    ('legal', 39, 40, 46),
    ('quality', 50, 51, 58),
    ('cameral', 62, 63, 75),
    ('coordination', 79, 80, 88),
    ('uao', 92, 93, 98),
    ('financial-audit', 102, 103, 119),
    ('compliance-audit', 123, 124, 141),
    ('digital-risks', 145, 146, 156),
    ('audit-cooperation', 160, 161, 166),
]
EXPECTED_HEADERS = {'B1': '№', 'C1': 'Наименование должности', 'D1': 'ФИО', 'E1': 'Примечание'}


def extract(path, reader):
    book = openpyxl.load_workbook(path, data_only=False)
    assert book.sheetnames == ['Лист1'], 'Review changed source sheet list.'
    source = book['Лист1']
    assert source.max_row == 174, 'Review changed source row layout.'
    assert {ref: source[ref].value for ref in EXPECTED_HEADERS} == EXPECTED_HEADERS, 'Review changed source headings.'
    # F/G contain no values, borders, fills or merges. Their isolated font and
    # alignment remnants are not additional report fields or meaningful margins.
    assert all(cell.value is None or isinstance(cell.value, str) and not cell.value.strip()
               for row in source.iter_rows(min_col=6) for cell in row), 'Review content beyond source report fields.'
    assert all(not cell.fill.patternType and not any(getattr(cell.border, edge).style for edge in ['left', 'right', 'top', 'bottom'])
               for row in source.iter_rows(min_col=6) for cell in row), 'Review source formatting beyond report fields.'
    assert all(merged.max_col <= 5 for merged in source.merged_cells.ranges), 'Review source merges beyond report fields.'
    allowed = set(EXPECTED_HEADERS)
    sections, data_rows = [], []
    for identity, header, first, last in SECTIONS:
        label = source[f'B{header}'].value
        assert isinstance(label, str) and label.strip(), 'Missing section label.'
        assert f'B{header}:D{header}' in {str(merged) for merged in source.merged_cells.ranges}, 'Review section merge.'
        allowed.add(f'B{header}')
        section_rows = list(range(first, last + 1))
        sections.append({'id': identity, 'label': label, 'headerRow': header,
                         'labelCell': f'B{header}', 'dataRows': section_rows})
        for row in section_rows:
            ordinal = source[f'B{row}'].value
            assert isinstance(ordinal, int) and ordinal > 0, 'Review source slot numbering.'
            allowed.add(f'B{row}')
            data_rows.append({'id': f'kvga-row-{row:03d}', 'sectionId': identity,
                              'sourceRow': row, 'ordinal': ordinal, 'ordinalCell': f'B{row}'})
    layout = reader(path, sheet_name='Лист1', column_count=5, row_count=174, allowed_cells=allowed)
    # Keep the supplied numbering verbatim, including the omitted 49 and the
    # repeated 60. These are template slots, not a statement of actual headcount.
    ordinals = [row['ordinal'] for row in data_rows]
    assert len(ordinals) == 117 and 49 not in ordinals and ordinals.count(60) == 2
    columns = [{'letter': get_column_letter(column),
                'labels': [EXPECTED_HEADERS[f'{get_column_letter(column)}1']]
                if f'{get_column_letter(column)}1' in EXPECTED_HEADERS else []}
               for column in range(1, 6)]
    return {'id': FORM_ID, 'name': 'Список сотрудников КВГА', 'sourceFile': path.name,
            'departmentId': 'personnel', 'catalogNumber': 1, 'sources': [], 'engine': 'personnel',
            'sheets': [{'id': f'{FORM_ID}-s1', 'key': 'staff', 'name': 'Лист1',
                        'sourceSheetName': 'Лист1', 'kind': 'matrix', 'columnCount': 5,
                        'headerDepth': 1, 'sourceHeaderRows': [1, 1],
                        'headerCells': EXPECTED_HEADERS, 'merges': [], 'columns': columns,
                        'valueColumns': ['C', 'D', 'E'], 'sections': sections, 'dataRows': data_rows,
                        'templateLayout': layout,
                        'sourcePlacement': {'prefixEnd': 1, 'bodyStart': 2, 'bodyEnd': 174,
                                            'labelColumns': ['B']}}]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', type=Path, default=Path('personnel-schemas.js'))
    args = parser.parse_args()
    spec = importlib.util.spec_from_file_location('source_layout', Path(__file__).with_name('source-layout.py'))
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    form = extract(args.source, helper.extract_source_layout)
    args.output.write_text('// Source structure only. Staff names, position titles and notes come from runtime data; empty slots do not imply vacancies.\nexport const personnelForms = '
                          + json.dumps([form], ensure_ascii=False, separators=(',', ':')) + ';\n')
    sheet = form['sheets'][0]
    print(json.dumps({'id': form['id'], 'sheet': sheet['name'],
                      'rows': sheet['templateLayout']['rowCount'], 'columns': sheet['columnCount'],
                      'sections': len(sheet['sections']), 'slots': len(sheet['dataRows'])}, ensure_ascii=False))


if __name__ == '__main__':
    main()
