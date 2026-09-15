import fsp from 'node:fs/promises';
import path from 'node:path';

import mammoth from 'mammoth';

import { compactText } from '../lib/utils.js';

export function createDocumentAgent() {
  return {
    name: 'document',
    async prepare(file, promptFactory) {
      const extension = path.extname(file.originalname).toLowerCase();
      let localText = '';

      if (extension === '.docx') {
        const result = await mammoth.extractRawText({ buffer: await fsp.readFile(file.path) });
        localText = compactText(result.value || '');
      } else if (['.txt', '.md', '.rtf'].includes(extension)) {
        localText = compactText(await fsp.readFile(file.path, 'utf8'));
      } else if (extension === '.doc') {
        throw new Error('Legacy .doc files cannot be read reliably. Convert this CV to PDF or DOCX and upload it again.');
      } else {
        throw new Error('Unsupported document type. Use PDF, DOCX, TXT, MD, RTF, PNG, JPG, or WEBP.');
      }

      if (!localText) {
        throw new Error('No readable text was found in this document.');
      }

      return { mode: 'document-text', input: promptFactory(localText) };
    }
  };
}
