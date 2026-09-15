import path from 'node:path';

export function safeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function isMainModule(currentFile, { argv = process.argv, env = process.env } = {}) {
  const entryFile = env.pm_exec_path || argv[1];
  return Boolean(entryFile && path.resolve(entryFile) === path.resolve(currentFile));
}

export function clampConfidence(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : 0;
}

export function compactText(value) {
  return safeString(value)
    .replace(/\u0000/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function dateStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

export function sanitizeFileName(fileName) {
  const parsed = path.parse(safeString(fileName).replaceAll('\\', '/'));
  const base = `${parsed.name}${parsed.ext}` || 'cv-file';
  return (
    base
      .replace(/[^a-zA-Z0-9._ -]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160) || 'cv-file'
  );
}

export function mimeFromName(fileName) {
  const ext = path.extname(safeString(fileName)).toLowerCase();
  const lookup = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc': 'application/msword',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.csv': 'text/csv',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.rtf': 'application/rtf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp'
  };
  return lookup[ext] || 'application/octet-stream';
}

export function isImageFile(file) {
  return safeString(file?.mimetype).startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file?.originalname || '');
}

export function isSpreadsheetFile(file) {
  const name = safeString(file?.originalname || file?.name || '');
  const mime = safeString(file?.mimetype || '');
  return /\.(xlsx|xls|csv)$/i.test(name) || /spreadsheet|excel|csv/i.test(mime);
}

export function uniqueStrings(values) {
  return [...new Set(values.map(safeString).filter(Boolean))];
}

export function firstValue(...values) {
  return values.map(safeString).find(Boolean) || '';
}

export function normalizeComparableText(value) {
  return safeString(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function combinePageText(leftValue, rightValue, separator = '; ') {
  const left = safeString(leftValue);
  const right = safeString(rightValue);
  if (!left) return right;
  if (!right) return left;

  const normalLeft = normalizeComparableText(left);
  const normalRight = normalizeComparableText(right);
  if (normalLeft === normalRight) return left.length >= right.length ? left : right;
  if (normalLeft.includes(normalRight)) return left;
  if (normalRight.includes(normalLeft)) return right;
  return `${left}${separator}${right}`;
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function estimateTaskWeight(file, maxWeight) {
  if (file?.skipError) return 1;
  const size = Math.max(0, Number(file?.size || 0));
  const overhead = 8 * 1024 * 1024;
  // Binary buffers, parser state, base64 strings, and request payloads coexist briefly.
  const estimatedBytes = Math.ceil(size * 2.5) + overhead;
  return Math.min(maxWeight, Math.max(1024 * 1024, estimatedBytes));
}

export function errorMessage(error, fallback = 'Unexpected error.') {
  return safeString(error?.message) || fallback;
}
