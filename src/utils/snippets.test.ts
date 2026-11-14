import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClientSnippet } from './snippets.ts';

test('buildClientSnippet generates OpenAI SDK snippet for /v1/chat/completions', () => {
  const code = buildClientSnippet('python_openai', {
    baseUrl: 'https://example.run.app/',
    endpoint: '/v1/chat/completions',
    model: 'gemini-4-hydrogen',
    prompt: 'Hello world',
    stream: true,
  });

  assert.match(code, /base_url="https:\/\/example\.run\.app\/v1"/);
  assert.match(code, /model="gemini-4-hydrogen"/);
  assert.match(code, /stream=True/);
});

test('buildClientSnippet generates cURL snippet for /v1/generate and /v1/embeddings', () => {
  const genCurl = buildClientSnippet('curl', {
    baseUrl: 'http://localhost:3000',
    endpoint: '/v1/generate',
    model: 'gemini-3.1-flash-lite',
    prompt: 'Ping',
    stream: false,
    thinkingLevel: 'MINIMAL',
  });
  assert.match(genCurl, /http:\/\/localhost:3000\/v1\/generate/);
  assert.match(genCurl, /"thinkingLevel": "MINIMAL"/);

  const embedTs = buildClientSnippet('typescript', {
    baseUrl: 'http://localhost:3000',
    endpoint: '/v1/embeddings',
    model: 'gemini-embedding-2',
    prompt: 'Vectorize me',
    stream: false,
  });
  assert.match(embedTs, /http:\/\/localhost:3000\/v1\/embeddings/);
  assert.match(embedTs, /gemini-embedding-2/);
});
