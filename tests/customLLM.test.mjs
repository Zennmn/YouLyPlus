import test from 'node:test';
import assert from 'node:assert/strict';
import { CustomLLMProvider, customLLMEndpoint } from '../src/background/services/translation/providers/CustomLLMProvider.js';
import { normalizeAppleLyricsOrder } from '../src/lib/appleLyricsSources.js';

test('custom API address supports origin, versioned base and full Chat Completions endpoint', () => {
  assert.equal(customLLMEndpoint('https://example.com').href, 'https://example.com/v1/chat/completions');
  assert.equal(customLLMEndpoint('https://example.com/api/v1/').href, 'https://example.com/api/v1/chat/completions');
  assert.equal(customLLMEndpoint('http://localhost:1234/v1/chat/completions').href, 'http://localhost:1234/v1/chat/completions');
  assert.throws(() => customLLMEndpoint('https://key@example.com/v1'));
  assert.throws(() => customLLMEndpoint('file:///local'));
});

test('third-party LLM sends the configured model and key, and accepts fenced JSON', async () => {
  const original = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ choices: [{ message: { content: '```json\n{"translated_lyrics":["你好","晚安"]}\n```' } }] }));
  };
  try {
    const provider = new CustomLLMProvider({ customLLMBaseUrl: 'https://example.com/v1', customLLMApiKey: 'test-key', customLLMModel: 'my-model' });
    assert.deepEqual(await provider.translate(['Hello', 'Good night'], 'zh-CN'), ['你好', '晚安']);
    assert.equal(request.body.model, 'my-model');
    assert.equal(request.options.headers.Authorization, 'Bearer test-key');
    assert.equal(request.options.redirect, 'error');
    assert.equal(request.body.stream, false);
    assert.ok(!('response_format' in request.body));
  } finally { globalThis.fetch = original; }
});

test('third-party LLM rejects line mismatches and HTTP errors without exposing server bodies', async () => {
  const original = globalThis.fetch;
  const provider = new CustomLLMProvider({ customLLMBaseUrl: 'http://localhost:1234/v1', customLLMModel: 'local-model' });
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"translated_lyrics":[]}' } }] }));
    await assert.rejects(provider.translate(['Hello'], 'zh'), /line count/);
    globalThis.fetch = async () => new Response('private details', { status: 401 });
    await assert.rejects(provider.translate(['Hello'], 'zh'), { message: 'Third-party LLM HTTP 401' });
  } finally { globalThis.fetch = original; }
});

test('custom API authorization is checked before sending any request', async () => {
  const originalChrome = globalThis.chrome, originalFetch = globalThis.fetch;
  let called = false;
  globalThis.chrome = { permissions: { contains: async () => false } };
  globalThis.fetch = async () => { called = true; };
  try {
    await assert.rejects(new CustomLLMProvider({ customLLMBaseUrl: 'https://example.com', customLLMModel: 'test' }).translate(['Hi'], 'zh'), /Authorize/);
    assert.equal(called, false);
  } finally { globalThis.chrome = originalChrome; globalThis.fetch = originalFetch; }
});

test('source settings preserve chosen order, remove duplicates and keep Apple Music last', () => {
  assert.deepEqual(normalizeAppleLyricsOrder('amlyrics,applemusic,amll,amlyrics,unknown'), ['amlyrics','amll','applemusic']);
  assert.deepEqual(normalizeAppleLyricsOrder(''), ['applemusic']);
});
