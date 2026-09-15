import fsp from 'node:fs/promises';
import path from 'node:path';

import { PDFParse } from 'pdf-parse';

import { compactText } from '../lib/utils.js';

export function createPdfAgent(config) {
  return {
    name: 'pdf',
    async prepare(file, promptFactory) {
      const buffer = await fsp.readFile(file.path);
      let localText = '';

      try {
        const parser = new PDFParse({ data: buffer });
        try {
          const result = await parser.getText();
          localText = compactText(result.text || '');
        } finally {
          await parser.destroy();
        }
      } catch (error) {
        console.warn(`PDF text extraction failed for ${file.originalname}: ${error.message}`);
      }

      if (localText.length >= config.localTextThreshold) {
        return { mode: 'pdf-text', input: promptFactory(localText) };
      }

      const filename = path.basename(file.originalname.replaceAll('\\', '/')) || 'cv.pdf';
      return {
        mode: 'pdf-vision',
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_file',
                filename,
                file_data: `data:application/pdf;base64,${buffer.toString('base64')}`
              },
              { type: 'input_text', text: promptFactory('') }
            ]
          }
        ]
      };
    }
  };
}
