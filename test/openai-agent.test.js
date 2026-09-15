import assert from 'node:assert/strict';
import test from 'node:test';

import { createOpenAiAgent } from '../src/agents/openai-agent.js';

test('OpenAI agent retries rate limits with bounded backoff', async () => {
  let calls = 0;
  const waits = [];
  const client = {
    responses: {
      async create() {
        calls += 1;
        if (calls === 1) {
          const error = new Error('rate limited');
          error.status = 429;
          throw error;
        }
        return { output_text: '{"ok":true}' };
      }
    }
  };
  const agent = createOpenAiAgent({
    client,
    schema: { type: 'object' },
    config: {
      openAiModel: 'test-model',
      openAiMaxRetries: 2,
      openAiRetryBaseMs: 100,
      openAiRetryMaxMs: 1000
    },
    sleep: async (ms) => waits.push(ms),
    random: () => 0.5
  });

  const result = await agent.extract('input');
  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 2);
  assert.deepEqual(waits, [100]);
});
