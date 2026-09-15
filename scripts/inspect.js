import ExcelJS from 'exceljs';

async function inspect(filename) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filename);
  console.log('=== File:', filename, '===');
  wb.worksheets.forEach(ws => {
    console.log('Sheet:', ws.name, 'RowCount:', ws.rowCount);
    for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
      const row = ws.getRow(r);
      const vals = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        let val = cell.value;
        if (val && typeof val === 'object') {
          val = val.result || val.text || val.hyperlink || JSON.stringify(val);
        }
        vals.push(`Col ${colNumber}: "${val}"`);
      });
      if (vals.length > 0) {
        console.log(`Row ${r}:`, vals.join(' | '));
      }
    }
  });
}

async function run() {
  await inspect('a7jobs-applications.xlsx');
  console.log('\n----------------------------------------\n');
  await inspect('A7 group cv data (1).xlsx');
}

run().catch(console.error);
