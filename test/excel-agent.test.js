import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import ExcelJS from 'exceljs';

import { createExcelAgent } from '../src/agents/excel-agent.js';

test('Excel contains successful candidate details only', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'cv-auto-excel-'));
  const destination = path.join(root, 'result.xlsx');
  const rows = [
    {
      status: 'ok',
      name: 'Ayesha Malik',
      email: 'ayesha@example.com',
      sourceFile: 'ayesha.pdf',
      cacheHit: 'yes',
      error: 'internal error should not export'
    },
    {
      status: 'ok',
      name: 'IMG-20260614-WA0009.jpg',
      sourceFile: 'IMG-20260614-WA0009.jpg',
      summary: 'No readable details'
    },
    { status: 'failed', name: 'invoice.pdf', summary: 'Not a CV' }
  ];

  await createExcelAgent().build(rows, destination);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(destination);
  const sheet = workbook.getWorksheet('CV Data');
  const headers = sheet.getRow(1).values.slice(1);

  assert.equal(sheet.rowCount, 2);
  assert.equal(sheet.getCell('A2').value, 'Ayesha Malik');
  assert.ok(headers.includes('Email Address'));
  assert.ok(!headers.includes('Status'));
  assert.ok(!headers.includes('Cache Hit'));
  assert.ok(!headers.includes('Error'));

  await fsp.rm(root, { recursive: true, force: true });
});

test('extractSpreadsheet reads candidate rows from uploaded Excel workbook', async () => {
  const { extractSpreadsheet } = await import('../src/agents/cv-agent.js');
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'cv-auto-import-'));
  const testExcelPath = path.join(root, 'candidates.xlsx');

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Applications');
  ws.addRow(['Full Name', 'Mobile 1', 'Email Address', 'Current Position', 'Highest Education']);
  ws.addRow(['Zainab Ahmed', '+971501234567', 'zainab@example.com', 'Property Consultant', 'Bachelor of Commerce']);
  ws.addRow(['Hamza Tariq', '+971559876543', 'hamza@example.com', 'Sales Manager', 'Master in Real Estate']);
  await wb.xlsx.writeFile(testExcelPath);

  const file = {
    originalname: 'candidates.xlsx',
    storedName: '00001-candidates.xlsx',
    path: testExcelPath
  };

  const results = await extractSpreadsheet(file, 'Real Estate Agent');
  assert.equal(Array.isArray(results), true);
  assert.equal(results.length, 2);
  assert.equal(results[0].name, 'Zainab Ahmed');
  assert.equal(results[0].phoneNumber, '+971501234567');
  assert.equal(results[0].email, 'zainab@example.com');
  assert.equal(results[0].designation, 'Property Consultant');
  assert.equal(results[0].education, 'Bachelor of Commerce');
  assert.equal(results[0].status, 'ok');

  assert.equal(results[1].name, 'Hamza Tariq');
  assert.equal(results[1].phoneNumber, '+971559876543');
  assert.equal(results[1].email, 'hamza@example.com');

  await fsp.rm(root, { recursive: true, force: true });
});
