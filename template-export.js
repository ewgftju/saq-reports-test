// Render the supplied workbook grid without inserting report or metadata rows.
// Layouts contain only template structure and the generated report snapshot.
const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const pre='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');
const col=n=>{let s='';for(;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
const point=ref=>{const match=/^([A-Z]+)([1-9]\d*)$/.exec(ref);if(!match)throw new Error('Неверная координата ячейки образца.');return {column:[...match[1]].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0),row:Number(match[2])};};
const attr=(value,keys)=>keys.filter(k=>value?.[k]!=null).map(k=>` ${k}="${esc(typeof value[k]==='boolean'?Number(value[k]):value[k])}"`).join('');
const color=value=>{if(!value)return '';if(typeof value==='object')return `<color${attr(value,['rgb','indexed','theme','tint','auto'])}/>`;const rgb=value.replace(/^#/,'');return /^[a-f\d]{6,8}$/i.test(rgb)?`<color rgb="${rgb.length===6?'FF':''}${rgb}"/>`:'';};

function styleBook(){
 const fonts=[],fills=['<fill><patternFill patternType="none"/></fill>','<fill><patternFill patternType="gray125"/></fill>'],borders=[],formats=[],xfs=[];
 const add=(items,value)=>{let i=items.indexOf(value);if(i<0){i=items.length;items.push(value);}return i;};
 function register(style={}){
  const f=style.font||{},alignment=style.alignment||{};
  const fontId=add(fonts,`<font>${f.bold?'<b/>':''}${f.italic?'<i/>':''}${f.underline?`<u val="${esc(f.underline===true?'single':f.underline)}"/>`:''}${f.strike?'<strike/>':''}<sz val="${esc(f.size||11)}"/>${color(f.color)}<name val="Times New Roman"/></font>`);
  const fill=style.fill||{},fillId=fill.color?add(fills,`<fill><patternFill patternType="${esc(fill.patternType||'solid')}">${color(fill.color).replace('<color','<fgColor')}${fill.background?color(fill.background).replace('<color','<bgColor'):''}</patternFill></fill>`):0;
  const border=style.border||{},borderId=add(borders,`<border${attr(border,['diagonalUp','diagonalDown'])}>${['left','right','top','bottom','diagonal'].map(side=>`<${side}${border[side]?.style?` style="${esc(border[side].style)}"`:''}>${color(border[side]?.color)}</${side}>`).join('')}</border>`);
  const format=style.numberFormat||'General',numFmtId=format==='General'?0:164+add(formats,format);
  return add(xfs,`<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment${attr(alignment,['horizontal','vertical','wrapText','textRotation','shrinkToFit','indent','readingOrder'])}/></xf>`);
 }
 register();
 return {register,xml:()=>`${pre}<styleSheet xmlns="${ns}"><numFmts count="${formats.length}">${formats.map((f,i)=>`<numFmt numFmtId="${164+i}" formatCode="${esc(f)}"/>`).join('')}</numFmts><fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills><borders count="${borders.length}">${borders.join('')}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`};
}

function worksheet(layout,book){
 const {columnCount,rowCount}=layout;
 if(!Number.isInteger(columnCount)||columnCount<1||columnCount>16384||!Number.isInteger(rowCount)||rowCount<1||rowCount>1048576)throw new Error('Неверные размеры исходного образца.');
 const cells=layout.cells||{},cellStyles=layout.cellStyles||{},styleIds=(layout.styles||[]).map(style=>book.register(style)),rows=new Map();
 for(const ref of new Set([...Object.keys(cells),...Object.keys(cellStyles)])){
  const p=point(ref),value=cells[ref];
  if(p.column>columnCount||p.row>rowCount)throw new Error('Ячейка выходит за границы исходного образца.');
  if(value!=null&&!['number','string','boolean'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value))throw new Error('Недопустимое значение ячейки образца.');
  const local=cellStyles[ref];if(local!=null&&!Number.isInteger(styleIds[local]))throw new Error('Неизвестный стиль ячейки образца.');
  const s=styleIds[local]??0,body=value==null?`<c r="${ref}" s="${s}"/>`:typeof value==='number'?`<c r="${ref}" s="${s}"><v>${value}</v></c>`:typeof value==='boolean'?`<c r="${ref}" s="${s}" t="b"><v>${Number(value)}</v></c>`:`<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
  if(!rows.has(p.row))rows.set(p.row,[]);rows.get(p.row).push({column:p.column,body});
 }
 const hiddenRows=new Set((layout.hiddenRows||[]).map(Number)),hiddenColumns=new Set((layout.hiddenColumns||[]).map(String));
 const heights=layout.rowHeights||{};
 const body=Array.from({length:rowCount},(_,i)=>{const r=i+1,h=heights[r];return `<row r="${r}"${h!=null?` ht="${esc(h)}" customHeight="1"`:''}${hiddenRows.has(r)?' hidden="1"':''}>${(rows.get(r)||[]).sort((a,b)=>a.column-b.column).map(c=>c.body).join('')}</row>`;}).join('');
 const widths=layout.columnWidths||{},columns=Array.from({length:columnCount},(_,i)=>{const n=i+1,w=widths[col(n)]??widths[n];return `<col min="${n}" max="${n}"${w!=null?` width="${esc(w)}" customWidth="1"`:''}${hiddenColumns.has(col(n))||hiddenColumns.has(String(n))?' hidden="1"':''}/>`;}).join('');
 const merges=layout.merges||[];
 for(const ref of merges){const ends=ref.split(':').map(point);if(ends.length!==2||ends[1].row>rowCount||ends[1].column>columnCount||ends[0].row>ends[1].row||ends[0].column>ends[1].column)throw new Error('Объединение выходит за границы исходного образца.');}
 const setup=layout.pageSetup||{};
 return `${pre}<worksheet xmlns="${ns}"><sheetPr><pageSetUpPr${attr(layout.pageSetupProperties||{fitToPage:setup.fitToWidth!=null||setup.fitToHeight!=null},['fitToPage','autoPageBreaks'])}/></sheetPr><dimension ref="A1:${col(columnCount)}${rowCount}"/><sheetViews><sheetView workbookViewId="0"${attr(layout.sheetView,['showGridLines','zoomScale'])}/></sheetViews><sheetFormatPr defaultRowHeight="${esc(layout.defaultRowHeight||15)}"${attr(layout,['defaultColWidth'])}/><cols>${columns}</cols><sheetData>${body}</sheetData>${merges.length?`<mergeCells count="${merges.length}">${merges.map(ref=>`<mergeCell ref="${ref}"/>`).join('')}</mergeCells>`:''}<printOptions${attr(layout.printOptions,['horizontalCentered','verticalCentered','headings','gridLines','gridLinesSet'])}/><pageMargins${attr({left:0.7,right:0.7,top:0.75,bottom:0.75,header:0.3,footer:0.3,...layout.pageMargins},['left','right','top','bottom','header','footer'])}/><pageSetup${attr(setup,['orientation','paperSize','scale','fitToWidth','fitToHeight','firstPageNumber','useFirstPageNumber','blackAndWhite','draft','horizontalDpi','verticalDpi','pageOrder'])}/></worksheet>`;
}

export function renderTemplateWorkbook(sources){
 const book=styleBook(),defined=[];
 const sheets=sources.map(({name,layout},i)=>{
  const sheetRef=`'${name.replaceAll("'","''")}'!`;
  const localRange=value=>String(value).split(',').map(part=>sheetRef+part.slice(part.lastIndexOf('!')+1)).join(',');
  if(layout.printArea)defined.push(`<definedName name="_xlnm.Print_Area" localSheetId="${i}">${esc(localRange(layout.printArea))}</definedName>`);
  const titles=[layout.printTitlesRows,layout.printTitlesCols].filter(Boolean);
  if(titles.length)defined.push(`<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${esc(titles.map(localRange).join(','))}</definedName>`);
  return {name,xml:worksheet(layout,book)};
 });
 return {sheets,stylesXml:book.xml(),definedNamesXml:defined.length?`<definedNames>${defined.join('')}</definedNames>`:''};
}
