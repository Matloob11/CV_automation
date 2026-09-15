import path from 'node:path';

import { isImageFile } from '../lib/utils.js';

export function createInputRouter({ imageAgent, pdfAgent, documentAgent }) {
  return {
    async prepare(file, promptFactory) {
      const extension = path.extname(file.originalname).toLowerCase();
      if (isImageFile(file)) {
        return imageAgent.prepare(file, promptFactory);
      }
      if (file.mimetype === 'application/pdf' || extension === '.pdf') {
        return pdfAgent.prepare(file, promptFactory);
      }
      return documentAgent.prepare(file, promptFactory);
    }
  };
}
