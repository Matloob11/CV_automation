import { delay, errorMessage } from '../lib/utils.js';

export function createOpenAiAgent({ client, config, schema, sleep = delay, random = Math.random }) {
  async function extract(input, context = {}) {
    let lastError;

    for (let attempt = 0; attempt <= config.openAiMaxRetries; attempt += 1) {
      try {
        const response = await client.responses.create({
          model: config.openAiModel,
          input,
          text: {
            format: {
              type: 'json_schema',
              name: 'cv_extraction',
              strict: true,
              schema
            }
          }
        });

        if (!response.output_text) {
          const error = new Error('OpenAI returned no structured extraction output.');
          error.code = 'MODEL_OUTPUT_INVALID';
          throw error;
        }

        try {
          return JSON.parse(response.output_text);
        } catch {
          const error = new Error('OpenAI returned invalid structured extraction output.');
          error.code = 'MODEL_OUTPUT_INVALID';
          throw error;
        }
      } catch (error) {
        lastError = error;
        if (attempt >= config.openAiMaxRetries || !isRetryable(error)) {
          throw error;
        }

        const waitMs = retryDelay(error, attempt, config, random);
        const label = context.fileName ? ` for ${context.fileName}` : '';
        console.warn(
          `OpenAI request${label} failed (${errorMessage(error)}). Retrying ${attempt + 1}/${config.openAiMaxRetries} in ${waitMs} ms.`
        );
        await sleep(waitMs);
      }
    }

    throw lastError;
  }

  return { extract };
}

function isRetryable(error) {
  const status = Number(error?.status || error?.response?.status || 0);
  if ([408, 409, 429].includes(status) || status >= 500) {
    return true;
  }

  const code = String(error?.code || '').toUpperCase();
  if (
    [
      'ECONNRESET',
      'ECONNREFUSED',
      'EPIPE',
      'ETIMEDOUT',
      'ENETUNREACH',
      'EAI_AGAIN',
      'MODEL_OUTPUT_INVALID'
    ].includes(code)
  ) {
    return true;
  }

  return ['APIConnectionError', 'APIConnectionTimeoutError'].includes(error?.name);
}

function retryDelay(error, attempt, config, random) {
  const retryAfterMs = Number(error?.headers?.get?.('retry-after-ms') || 0);
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    return Math.min(config.openAiRetryMaxMs, Math.round(retryAfterMs));
  }

  const retryAfterSeconds = Number(error?.headers?.get?.('retry-after') || 0);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(config.openAiRetryMaxMs, Math.round(retryAfterSeconds * 1000));
  }

  const exponential = config.openAiRetryBaseMs * 2 ** attempt;
  const jitter = 0.75 + random() * 0.5;
  return Math.max(1, Math.min(config.openAiRetryMaxMs, Math.round(exponential * jitter)));
}
