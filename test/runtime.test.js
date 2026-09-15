import assert from 'node:assert/strict';
import test from 'node:test';

import { isMainModule } from '../src/lib/utils.js';

test('main-module detection supports direct Node and PM2 launches', () => {
  const serverFile = '/opt/cv-auto/server.js';

  assert.equal(isMainModule(serverFile, { argv: ['node', serverFile], env: {} }), true);
  assert.equal(
    isMainModule(serverFile, {
      argv: ['/usr/bin/node', '/usr/lib/node_modules/pm2/lib/ProcessContainerFork.js'],
      env: { pm_exec_path: serverFile }
    }),
    true
  );
  assert.equal(isMainModule(serverFile, { argv: ['node', '/opt/cv-auto/test.js'], env: {} }), false);
});
