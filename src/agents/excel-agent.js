import fsp from 'node:fs/promises';
import path from 'node:path';

import ExcelJS from 'exceljs';

import { excelColumns } from '../schema.js';
import { hasUsableCandidateDetails } from './candidate-policy.js';

export function createExcelAgent() {
  async function build(rows, excelPath = '') {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'CV Auto';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('CV Data', {
      views: [{ state: 'frozen', ySplit: 1 }]
    });
    worksheet.columns = excelColumns.map(([key, label]) => ({
      header: label,
      key,
      width: key === 'summary' ? 55 : key === 'address' ? 38 : key === 'education' ? 34 : 20
    }));

    for (const row of rows.filter(
      (item) => item.status === 'ok' && hasUsableCandidateDetails(item, item.sourceFile)
    )) {
      const record = {};
      for (const [key] of excelColumns) {
        record[key] = row[key] ?? '';
      }
      worksheet.addRow(record);
    }

    const header = worksheet.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF9B6A05' } };
    header.alignment = { vertical: 'middle' };
    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        cell.alignment = { vertical: 'top', wrapText: true };
      });
    });

    if (excelPath) {
      await fsp.mkdir(path.dirname(excelPath), { recursive: true });
      await workbook.xlsx.writeFile(excelPath);
      return '';
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer).toString('base64');
  }

  return { build };
}
