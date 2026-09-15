import assert from 'node:assert/strict';
import test from 'node:test';

import { delay } from '../src/lib/utils.js';
import { WorkLimiter } from '../src/queue/work-limiter.js';

test('WorkLimiter runs up to five tasks concurrently', async () => {
  const limiter = new WorkLimiter({ concurrency: 5, maxWeight: 100 });
  let active = 0;
  let peak = 0;

  await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      limiter.run(
        async () => {
          active += 1;
          peak = Math.max(peak, active);
          await delay(15);
          active -= 1;
          return index;
        },
        { weight: 1 }
      )
    )
  );

  assert.equal(peak, 5);
  assert.equal(limiter.stats().active, 0);
  assert.equal(limiter.stats().queued, 0);
});

test('WorkLimiter lowers concurrency when the memory budget is full', async () => {
  const limiter = new WorkLimiter({ concurrency: 5, maxWeight: 10 });
  let active = 0;
  let peak = 0;

  await Promise.all(
    Array.from({ length: 4 }, () =>
      limiter.run(
        async () => {
          active += 1;
          peak = Math.max(peak, active);
          await delay(10);
          active -= 1;
        },
        { weight: 6 }
      )
    )
  );

  assert.equal(peak, 1);
});
