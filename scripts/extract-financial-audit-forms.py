#!/usr/bin/env python3
"""Extract structural layouts of four financial-audit report samples.

Usage: python scripts/extract-financial-audit-forms.py /path/to/upload

openpyxl is read-only. Only headings and fixed regional/total labels are
allowlisted; the administrative example's people, companies, event dates,
amounts, ordinals and formulas are excluded. The shared reader applies Times
New Roman to Excel styles without changing the website's typography.
"""
import argparse
import importlib.util
import json
from pathlib import Path

import openpyxl
from openpyxl.utils.cell import get_column_letter, range_boundaries


DEFINITIONS = [
    {'id': 'financial-audit-approvals', 'name': 'Дела, направленные на согласование',
     'file': 'Таблица 3.xlsx', 'number': 3, 'sheet': 'Лист1', 'columns': 9, 'rows': 10,
     'header': (2, 2), 'placement': {'prefixEnd': 2, 'dataStart': 3, 'dataEnd': 10, 'labelColumns': []}},
    {'id': 'financial-audit-results', 'name': 'Результаты аудита финансовой отчетности',
     'file': 'Таблица 2.xlsx', 'number': 4, 'sheet': 'Лист1', 'columns': 13, 'rows': 3,
     'header': (2, 2), 'placement': {'prefixEnd': 2, 'dataStart': 3, 'dataEnd': 3, 'labelColumns': []}},
    {'id': 'financial-audit-transfers', 'name': 'Передача материалов в правоохранительные органы',
     'file': 'отчет передача 3.xlsx', 'number': 5, 'sheet': 'Лист1', 'columns': 13, 'rows': 51,
     'header': (1, 2), 'placement': {'prefixEnd': 2, 'bodyStart': 3, 'bodyEnd': 24, 'labelColumns': ['A', 'B']}},
    {'id': 'financial-audit-administrative', 'name': 'Еженедельная сводка по административным штрафам',
     'file': 'Учет АДМ 1.xlsx', 'number': 6, 'sheet': 'Еженедельная сводка', 'columns': 13, 'rows': 21,
     'header': (4, 4), 'placement': {'prefixEnd': 4, 'dataStart': 5, 'dataEnd': 9, 'totalRow': 10, 'labelColumns': ['A']}},
]

# Preserve source labels/ordering while exposing explicit canonical identities
# for aggregation. A city and the same-named region are distinct rows.
REGIONS = [
    ('astana', 'г. Астана', ['Астана', 'г.Астана']),
    ('almaty-city', 'г. Алматы', ['Алматы', 'г.Алматы']),
    ('almaty-region', 'Алматинская область', ['Алматы обл', 'Алматинская', 'Алматы облысы']),
    ('shymkent', 'г. Шымкент', ['Шымкент', 'г.Шымкент']),
    ('turkestan', 'Туркестанская область', ['Түркістан', 'Туркестан', 'Туркестанская']),
    ('kyzylorda', 'Кызылординская область', ['Қызылорда', 'Кызылорда', 'Кызылординская']),
    ('karaganda', 'Карагандинская область', ['Қарағанда', 'Караганды', 'Караганда', 'Карагандинская']),
    ('north-kazakhstan', 'Северо-Казахстанская область', ['СКО', 'Североказахстанская область']),
    ('west-kazakhstan', 'Западно-Казахстанская область', ['ЗКО', 'Западноказахстанская область']),
    ('east-kazakhstan', 'Восточно-Казахстанская область', ['ВКО', 'Восточноказахстанская область']),
    ('zhambyl', 'Жамбылская область', ['Жамбыл', 'Жамбылская']),
    ('aktobe', 'Актюбинская область', ['Актобе', 'Ақтөбе', 'Актюбинская']),
    ('mangystau', 'Мангистауская область', ['Мангыстау', 'Мангистау', 'Маңғыстау', 'Мангистауская']),
    ('atyrau', 'Атырауская область', ['Атырау', 'Атырауская']),
    ('kostanay', 'Костанайская область', ['Костанай', 'Қостанай', 'Костанайская']),
    ('pavlodar', 'Павлодарская область', ['Павлодар', 'Павлодарская']),
    ('akmola', 'Акмолинская область', ['Акмола', 'Ақмола', 'Акмолинская']),
    ('zhetysu', 'область Жетісу', ['Жетісу', 'Жетису', 'область Жетису']),
    ('ulytau', 'область Ұлытау', ['Ұлытау', 'Улытау', 'область Улытау']),
    ('abai', 'область Абай', ['Абай', 'Абайская область']),
    ('kvga', None, ['КВГА', 'ЦА', 'Центральный аппарат', 'Комитет внутреннего государственного аудита']),
]


def headers(layout, first, last):
    cells = {}
    for column in range(1, layout['columnCount'] + 1):
        letter = get_column_letter(column)
        for row in range(first, last + 1):
            value = layout['cells'].get(f'{letter}{row}')
            if value is not None and (not isinstance(value, str) or value.strip()):
                cells[f'{letter}{row-first+1}'] = value
    merges = []
    for ref in layout['merges']:
        c1, r1, c2, r2 = range_boundaries(ref)
        if first <= r1 <= r2 <= last:
            merges.append(f'{get_column_letter(c1)}{r1-first+1}:{get_column_letter(c2)}{r2-first+1}')
    columns = []
    for column in range(1, layout['columnCount'] + 1):
        labels = []
        for row in range(1, last-first+2):
            value = cells.get(f'{get_column_letter(column)}{row}')
            if value is None:
                for ref in merges:
                    c1, r1, c2, r2 = range_boundaries(ref)
                    if c1 <= column <= c2 and r1 <= row <= r2:
                        value = cells.get(f'{get_column_letter(c1)}{r1}')
                        break
            if value is not None and str(value) not in labels:
                labels.append(str(value))
        columns.append({'letter': get_column_letter(column), 'labels': labels})
    return {'columnCount': layout['columnCount'], 'headerDepth': last-first+1,
            'sourceHeaderRows': [first, last], 'headerCells': cells,
            'merges': sorted(merges), 'columns': columns}


def extract_form(directory, definition, reader):
    path = directory / definition['file']
    book = openpyxl.load_workbook(path, data_only=False)
    assert book.sheetnames == [definition['sheet']], 'Review changed source sheet list.'
    source = book[definition['sheet']]
    columns, rows = definition['columns'], definition['rows']
    prefix = definition['placement']['prefixEnd']
    allowed = [f'{get_column_letter(c)}{r}' for r in range(1, prefix+1) for c in range(1, columns+1)]
    if definition['id'] == 'financial-audit-transfers':
        allowed += [f'{c}{r}' for r in range(3, 24) for c in ['A', 'B']] + ['B24']
    if definition['id'] == 'financial-audit-administrative':
        allowed += ['A10']
    # Physical used ranges include empty footer styling, fills and blank merges:
    # preserve their rows/formatting, while excluding whitespace-only columns
    # after the actual report fields. They are not additional report fields.
    assert all(cell.value is None or isinstance(cell.value, str) and not cell.value.strip()
               for row in source for cell in row if cell.row > rows or cell.column > columns), 'Review source content outside table.'
    layout = reader(path, sheet_name=definition['sheet'], column_count=columns, row_count=rows,
                    allowed_cells=allowed)
    sheet = {'id': definition['id'] + '-s1', 'key': definition['id'].removeprefix('financial-audit-'),
             'name': definition['sheet'], 'sourceSheetName': definition['sheet'], 'kind': 'table',
             **headers(layout, *definition['header']), 'templateLayout': layout,
             'sourcePlacement': definition['placement']}
    if definition['id'] == 'financial-audit-transfers':
        data_rows = []
        for ordinal, (identity, region, aliases) in enumerate(REGIONS, 1):
            row = ordinal + 2
            label = layout['cells'][f'B{row}']
            assert layout['cells'][f'A{row}'] == ordinal and label.strip() in aliases
            data_rows.append({'id': identity, 'sourceRow': row, 'ordinal': ordinal,
                              'label': label, 'labelCell': f'B{row}', 'ordinalCell': f'A{row}',
                              'region': region, 'regionAliases': aliases, 'central': region is None})
        sheet['kind'] = 'region-summary'
        sheet['dataRows'] = data_rows
        sheet['totalRows'] = [{'id': 'overall-total', 'sourceRow': 24,
                               'label': layout['cells']['B24'], 'labelCell': 'B24'}]
    return {'id': definition['id'], 'name': definition['name'], 'sourceFile': definition['file'],
            'departmentId': 'financial-audit', 'catalogNumber': definition['number'],
            'sources': ['ВГА'], 'engine': 'financial-audit', 'sheets': [sheet]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', type=Path, default=Path('financial-audit-schemas.js'))
    args = parser.parse_args()
    spec = importlib.util.spec_from_file_location('source_layout', Path(__file__).with_name('source-layout.py'))
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    forms = [extract_form(args.source, definition, helper.extract_source_layout) for definition in DEFINITIONS]
    args.output.write_text('// Original structural layouts only. Customer examples, personal data, financial values, formulas and external links are excluded.\nexport const financialAuditForms = '
                          + json.dumps(forms, ensure_ascii=False, separators=(',', ':')) + ';\n')
    print(json.dumps([{'id': form['id'], 'sheets': [{'name': s['name'], 'rows': s['templateLayout']['rowCount'],
                        'columns': s['columnCount']} for s in form['sheets']]} for form in forms], ensure_ascii=False))


if __name__ == '__main__':
    main()
