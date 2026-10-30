#!/usr/bin/env python3
"""Read the 30.10.2026 PK workbook templates; never extract customer observations.

Usage: python scripts/extract-professional-forms.py /path/to/unpacked/archive
Only allowlisted headers, 17 indicator labels and 22 statutory descriptions are
published. The OPI body and all source formulas are deliberately excluded.
openpyxl is used for reading, not workbook authoring.
"""
from pathlib import Path
import argparse
import importlib.util
import json
import re
import openpyxl
from openpyxl.utils.cell import get_column_letter, range_boundaries

MANIFEST = [
    ('EGOV полугод список каз рус.xlsx', 'prof-halfyear-list', 20, 'Полугодовой перечень субъектов профилактического контроля (RU/KZ)', 1, 1, 39, 'Перечень RU-KZ', 'list'),
    ('Актуальная инф по перечню.xlsx', 'prof-list-execution', 21, 'Исполнение перечня профилактического контроля по ДВГА', 1, 2, 22, 'Исполнение перечня', 'execution'),
    ('Анализ АО.xlsx', 'prof-audit-organizations', 12, 'Анализ профилактического контроля аудиторских организаций', 1, 4, 38, 'Аудиторские организации', 'ao'),
    ('Анализ ОПИ 1-2025.xlsx', 'prof-public-interest', 6, 'Итоговый отчет по деятельности профилактического контроля (ОПИ)', 1, 5, 46, 'ОПИ', 'opi'),
    ('информация по ст КоАП.xlsx', 'prof-administrative', 1, 'Информация об административных взысканиях (ПК)', 1, 3, 12, 'Административные взыскания', 'administrative'),
    ('Таблица Упр Анализа.xlsx', 'prof-year-comparison', 19, 'Итоговый отчет по профилактическому контролю', 1, 2, 9, 'Профилактический контроль', 'comparison'),
]


def clean(value):
    return re.sub(r'\s+', ' ', str(value)).strip()


def header(ws, first, last, count):
    cells = {}
    for row in ws.iter_rows(min_row=first, max_row=last, max_col=count):
        for cell in row:
            if isinstance(cell.value, (str, int, float)) and cell.data_type != 'f':
                cells[f'{cell.column_letter}{cell.row-first+1}'] = cell.value
    merges = []
    for ref in ws.merged_cells.ranges:
        c1, r1, c2, r2 = range_boundaries(str(ref))
        if first <= r1 <= r2 <= last and c2 <= count:
            merges.append(f'{get_column_letter(c1)}{r1-first+1}:{get_column_letter(c2)}{r2-first+1}')
    columns = []
    for col in range(1, count + 1):
        labels = []
        for row in range(1, last-first+2):
            label = cells.get(f'{get_column_letter(col)}{row}')
            if label is None:
                for ref in merges:
                    c1, r1, c2, r2 = range_boundaries(ref)
                    if c1 <= col <= c2 and r1 <= row <= r2:
                        label = cells.get(f'{get_column_letter(c1)}{r1}')
                        break
            if isinstance(label, str) and label and label not in labels:
                labels.append(clean(label))
        columns.append({'letter': get_column_letter(col), 'labels': labels})
    return {'columnCount': count, 'headerDepth': last-first+1,
            'headerCells': cells, 'merges': sorted(merges), 'columns': columns,
            'sourceHeaderRows': [first, last]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=Path)
    parser.add_argument('--output', type=Path, default=Path('professional-schemas.js'))
    args = parser.parse_args()
    spec = importlib.util.spec_from_file_location('source_layout', Path(__file__).with_name('source-layout.py'))
    source_layout = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(source_layout)
    forms = []
    for filename, ident, number, name, first, last, count, sheet_name, kind in MANIFEST:
        ws = openpyxl.load_workbook(args.directory / filename, data_only=False).active
        schema = {'id': f'{ident}-main', 'name': ws.title, 'sourceSheetName': ws.title, 'kind': kind, **header(ws, first, last, count)}
        if kind in ['ao', 'administrative']:
            # A merged document title stays in the layout/header, but is not
            # repeated in every flattened UI or selected-export column label.
            schema['columns'] = header(ws, 2, last, count)['columns']
        allowed = {cell.coordinate for row in ws.iter_rows(min_row=first, max_row=last, max_col=count) for cell in row if cell.value is not None and cell.data_type != 'f'}
        if kind == 'execution':
            allowed.update(f'{col}{row}' for col in ['A', 'B'] for row in range(3, 23))
            allowed.add('A23')
            schema['regions'] = [{'sourceRow': row, 'ordinal': ws[f'A{row}'].value, 'label': ws[f'B{row}'].value} for row in range(3, 23)]
        elif kind == 'ao':
            allowed.add('A7')
            schema['totalRows'] = [{'row': 7, 'columns': [cell.column_letter for cell in ws[7] if cell.data_type == 'f']}]
        elif kind == 'opi':
            allowed.update(['C40', 'C42'])
            quantitative = {get_column_letter(col) for col in list(range(13, 37)) + [44, 45]}
            schema['totalRows'] = [{'row': row, 'columns': [cell.column_letter for cell in ws[row] if cell.data_type == 'f' and cell.column_letter in quantitative]} for row in [40, 42]]
        if kind == 'comparison':
            allowed.update(f'{col}{row}' for col in ['B', 'D', 'E'] for row in range(3, 20))
            indicators = []
            for row in range(3, 20):
                # Only the source indicator labels/units; no values or formulas.
                main = ws[f'B{row}'].value
                if main is None:
                    for ref in ws.merged_cells.ranges:
                        c1, r1, c2, r2 = range_boundaries(str(ref))
                        if c1 <= 2 <= c2 and r1 <= row <= r2:
                            main = ws.cell(r1, c1).value
                cells = {col: clean(ws[f'{col}{row}'].value) for col in ['D', 'E'] if ws[f'{col}{row}'].value is not None}
                if main is not None:
                    cells['B'] = clean(main)
                indicators.append({'sourceRow': row, 'cells': cells})
            schema['indicators'] = indicators
        schema['templateLayout'] = source_layout.extract_source_layout(args.directory / filename, allowed_cells=allowed)
        form = {'id': ident, 'name': name, 'sourceFile': f'в ЦЭФ по SAQ/{filename}',
                'departmentId': 'coordination', 'catalogNumber': number, 'sources': ['ПРОФ'],
                'engine': 'professional', 'sheets': [schema],
                'reportingRule': 'По отчетной дате записи за выбранный период. Поля профильного контроля заполняются из явных сведений дела.'}
        if kind == 'administrative':
            form['description'] = 'Сведения о взысканиях по аудиторским организациям.'
        elif kind == 'comparison':
            form['reportingRule'] = 'Основной период и те же даты прошлого года. Денежные показатели — млн тенге; процент изменения не рассчитывается при нулевой базе.'
        elif kind in ['list', 'execution']:
            form['reportingRule'] = 'Записи за выбранный отчетный период с явным признаком включения в перечень профилактического контроля.'
        forms.append(form)
    # This separate source file is a reference, not another sheet/report. It is
    # retained for development but is not attached to any generated workbook.
    filename2 = 'статьи КоАП УКСБУ.xlsx'
    lookup = openpyxl.load_workbook(args.directory / filename2, data_only=False).active
    dictionary = {'sourceFile': f'в ЦЭФ по SAQ/{filename2}', 'sourceSheetName': lookup.title,
                  'entries': [{'number': lookup.cell(row, 1).value, 'description': clean(lookup.cell(row, 2).value)} for row in range(3, 25)]}
    args.output.write_text('// Structural metadata from the customer templates received 30.10.2026. No customer observations or source formulas.\nexport const professionalForms = ' + json.dumps(forms, ensure_ascii=False, separators=(',', ':')) + ';\nexport const professionalReferenceSheets = ' + json.dumps([dictionary], ensure_ascii=False, separators=(',', ':')) + ';\n')


if __name__ == '__main__':
    main()
