#!/usr/bin/env python3
"""Read the 30.10.2026 PK workbook templates; never extract customer observations.

Usage: python scripts/extract-professional-forms.py /path/to/unpacked/archive
Only allowlisted headers, 17 indicator labels and 22 statutory descriptions are
published. The OPI body and all source formulas are deliberately excluded.
openpyxl is used for reading, not workbook authoring.
"""
from pathlib import Path
import argparse
import json
import re
import openpyxl
from openpyxl.utils.cell import get_column_letter, range_boundaries

MANIFEST = [
    ('EGOV полугод список каз рус.xlsx', 'prof-halfyear-list', 20, 'Полугодовой перечень субъектов профилактического контроля (RU/KZ)', 1, 1, 39, 'Перечень RU-KZ', 'list'),
    ('Актуальная инф по перечню.xlsx', 'prof-list-execution', 21, 'Исполнение перечня профилактического контроля по ДВГА', 1, 2, 22, 'Исполнение перечня', 'execution'),
    ('Анализ АО.xlsx', 'prof-audit-organizations', 12, 'Анализ профилактического контроля аудиторских организаций', 2, 3, 38, 'Аудиторские организации', 'ao'),
    ('Анализ ОПИ 1-2025.xlsx', 'prof-public-interest', 6, 'Итоговый отчет по деятельности профилактического контроля (ОПИ)', 1, 4, 46, 'ОПИ', 'opi'),
    ('информация по ст КоАП.xlsx', 'prof-administrative', 1, 'Информация об административных взысканиях (ПК)', 2, 2, 12, 'Административные взыскания', 'administrative'),
    ('Таблица Упр Анализа.xlsx', 'prof-year-comparison', 19, 'Итоговый отчет по профилактическому контролю', 1, 2, 9, 'Профилактический контроль', 'comparison'),
]


def clean(value):
    return re.sub(r'\s+', ' ', str(value)).strip()


def header(ws, first, last, count):
    cells = {}
    for row in ws.iter_rows(min_row=first, max_row=last, max_col=count):
        for cell in row:
            if isinstance(cell.value, str) and cell.data_type != 'f':
                cells[f'{cell.column_letter}{cell.row-first+1}'] = clean(cell.value)
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
            if label and label not in labels:
                labels.append(label)
        columns.append({'letter': get_column_letter(col), 'labels': labels})
    return {'columnCount': count, 'headerDepth': last-first+1,
            'headerCells': cells, 'merges': sorted(merges), 'columns': columns,
            'sourceHeaderRows': [first, last]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=Path)
    parser.add_argument('--output', type=Path, default=Path('professional-schemas.js'))
    args = parser.parse_args()
    forms = []
    for filename, ident, number, name, first, last, count, sheet_name, kind in MANIFEST:
        ws = openpyxl.load_workbook(args.directory / filename, data_only=False).active
        schema = {'id': f'{ident}-main', 'name': sheet_name, 'kind': kind, **header(ws, first, last, count)}
        if kind == 'execution':
            schema['headerCells']['C1'] = 'Всего по перечню за выбранный период'
            schema['columns'][2]['labels'] = [schema['headerCells']['C1']]
        if kind == 'comparison':
            schema['widths'] = [4, 58, 4, 42, 15, 24, 24, 20, 20]
            for letter, label in [('F', 'Основной период'), ('G', 'Аналогичный период прошлого года')]:
                schema['headerCells'][f'{letter}1'] = label
                schema['columns'][ord(letter)-65]['labels'] = [label]
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
        form = {'id': ident, 'name': name, 'sourceFile': f'в ЦЭФ по SAQ/{filename}',
                'departmentId': 'coordination', 'catalogNumber': number, 'sources': ['ПРОФ'],
                'engine': 'professional', 'sheets': [schema],
                'reportingRule': 'По отчетной дате записи за выбранный период. Поля профильного контроля заполняются из явных сведений дела.'}
        if kind == 'administrative':
            filename2 = 'статьи КоАП УКСБУ.xlsx'
            lookup = openpyxl.load_workbook(args.directory / filename2, data_only=False).active
            dictionary = {'id': f'{ident}-grounds', 'name': 'Основания КоАП из образца', 'kind': 'dictionary',
                          **header(lookup, 2, 2, 4),
                          'widths': [8, 80, 4, 4],
                          'entries': [{'number': lookup.cell(row, 1).value, 'description': clean(lookup.cell(row, 2).value)} for row in range(3, 25)]}
            form['sheets'].append(dictionary)
            form['supportingFiles'] = [f'в ЦЭФ по SAQ/{filename2}']
            form['description'] = 'Сведения о взысканиях по аудиторским организациям и справочный лист оснований из предоставленного образца.'
        elif kind == 'comparison':
            form['reportingRule'] = 'Основной период и те же даты прошлого года. Денежные показатели — млн тенге; процент изменения не рассчитывается при нулевой базе.'
        elif kind in ['list', 'execution']:
            form['reportingRule'] = 'Записи за выбранный отчетный период с явным признаком включения в перечень профилактического контроля.'
        forms.append(form)
    args.output.write_text('// Structural metadata from the customer templates received 30.10.2026. No customer observations or source formulas.\nexport const professionalForms = ' + json.dumps(forms, ensure_ascii=False, indent=2) + ';\n')


if __name__ == '__main__':
    main()
