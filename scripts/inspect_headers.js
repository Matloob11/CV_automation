import ExcelJS from 'exceljs';

async function inspectHeader(filename) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filename);
  console.log('=== File:', filename, '===');
  wb.worksheets.forEach(ws => {
    console.log('Sheet:', ws.name, 'RowCount:', ws.rowCount);
    const row1 = ws.getRow(1);
    const headers = [];
    row1.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      headers.push(`Col ${colNumber}: "${cell.value}"`);
    });
    console.log('Header Row 1:', headers.join('\n'));
    
    // Also show row 2
    const row2 = ws.getRow(2);
    const vals = [];
    row2.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      let v = cell.value;
      if (v && typeof v === 'object') v = v.result || v.text || v.hyperlink || JSON.stringify(v);
      vals.push(`Col ${colNumber}: "${v}"`);
    });
    console.log('\nRow 2 sample data:', vals.join('\n'));
  });
}

inspectHeader('a7jobs-applications.xlsx').catch(console.error);
