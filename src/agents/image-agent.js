import fsp from 'node:fs/promises';

import { mimeFromName } from '../lib/utils.js';

export function createImageAgent() {
  return {
    name: 'image',
    async prepare(file, promptFactory) {
      const mime = file.mimetype || mimeFromName(file.originalname);
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime)) {
        throw new Error('Unsupported image type. Use PNG, JPG, JPEG, or WEBP for image CV pages.');
      }

      const base64 = (await fsp.readFile(file.path)).toString('base64');
      return {
        mode: 'image',
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: promptFactory('') },
              {
                type: 'input_image',
                image_url: `data:${mime};base64,${base64}`,
                detail: 'high'
              }
            ]
          }
        ]
      };
    }
  };
}
