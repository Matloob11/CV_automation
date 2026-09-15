import ExcelJS from 'exceljs';

async function countRows(filename) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filename);
  console.log('=== Excel File:', filename, '===');
  let fileTotal = 0;
  wb.worksheets.forEach(ws => {
    const dataRows = Math.max(0, ws.rowCount - 1);
    console.log(`Sheet: "${ws.name}" | Total Rows: ${ws.rowCount} | Candidate Data Rows: ${dataRows}`);
    if (ws.name === 'Applications' || ws.name === 'CV Data') {
      fileTotal += dataRows;
    }
  });
  console.log(`Candidate rows count in ${filename}: ${fileTotal}\n`);
  return fileTotal;
}

async function run() {
  const c1 = await countRows('a7jobs-applications.xlsx');
  const c2 = await countRows('A7 group cv data (1).xlsx');
  console.log(`----------------------------------------`);
  console.log(`GRAND TOTAL CANDIDATE CVs ACROSS BOTH EXCEL FILES: ${c1 + c2}`);
  console.log(`----------------------------------------`);
}

run().catch(console.error);
