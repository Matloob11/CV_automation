import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

export function createCacheAgent(config) {
  async function read(file, defaultAppliedPost) {
    try {
      const payload = JSON.parse(await fsp.readFile(filePath(file, defaultAppliedPost), 'utf8'));
      if (payload.schemaVersion !== config.schemaVersion || payload.model !== config.openAiModel) {
        return null;
      }
      return payload.row || null;
    } catch {
      return null;
    }
  }

  async function write(file, defaultAppliedPost, row) {
    await fsp.mkdir(config.cacheRoot, { recursive: true });
    const destination = filePath(file, defaultAppliedPost);
    const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
    const payload = {
      schemaVersion: config.schemaVersion,
      model: config.openAiModel,
      fileHash: file.hash,
      appliedPost: defaultAppliedPost || '',
      createdAt: new Date().toISOString(),
      row
    };

    await fsp.writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    try {
      await fsp.rename(temporary, destination);
    } catch (error) {
      if (!['EEXIST', 'EPERM'].includes(error.code)) {
        await fsp.rm(temporary, { force: true }).catch(() => {});
        throw error;
      }
      await fsp.rm(destination, { force: true });
      await fsp.rename(temporary, destination).catch(async (renameError) => {
        await fsp.rm(temporary, { force: true }).catch(() => {});
        if (!['EEXIST', 'EPERM'].includes(renameError.code)) throw renameError;
      });
    }
  }

  function key(file, defaultAppliedPost) {
    return crypto
      .createHash('sha256')
      .update(config.schemaVersion)
      .update('|')
      .update(config.openAiModel)
      .update('|')
      .update(file.hash)
      .update('|')
      .update((defaultAppliedPost || '').trim().toLowerCase())
      .digest('hex');
  }

  function filePath(file, defaultAppliedPost) {
    return path.join(config.cacheRoot, `${key(file, defaultAppliedPost)}.json`);
  }

  return { read, write, key, filePath };
}
