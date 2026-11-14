import type { EndpointPath } from '../shared/inference.ts';

export type SnippetLanguage = 'curl' | 'python_openai' | 'typescript';

export interface SnippetOptions {
  baseUrl: string;
  endpoint: Extract<EndpointPath, '/v1/chat/completions' | '/v1/generate' | '/v1/embeddings'>;
  model: string;
  prompt: string;
  systemInstruction?: string;
  stream: boolean;
  thinkingLevel?: string;
}

export function buildClientSnippet(language: SnippetLanguage, options: SnippetOptions): string {
  const cleanBaseUrl = options.baseUrl.replace(/\/+$/, '');
  const promptEscaped = JSON.stringify(options.prompt || 'Explain edge caching in two sentences.');
  const systemEscaped = options.systemInstruction?.trim()
    ? JSON.stringify(options.systemInstruction.trim())
    : null;

  if (options.endpoint === '/v1/embeddings') {
    if (language === 'curl') {
      return `curl -X POST "${cleanBaseUrl}/v1/embeddings" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${options.model}",
    "input": ${promptEscaped}
  }'`;
    }
    if (language === 'python_openai') {
      return `from openai import OpenAI

client = OpenAI(
    base_url="${cleanBaseUrl}/v1",
    api_key="public-gateway"
)

res = client.embeddings.create(
    model="${options.model}",
    input=${promptEscaped}
)

print(len(res.data[0].embedding), res.data[0].embedding[:5])`;
    }
    return `const response = await fetch("${cleanBaseUrl}/v1/embeddings", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "${options.model}",
    input: ${promptEscaped},
  }),
});

const data = await response.json();
console.log(data.data[0].embedding.slice(0, 5));`;
  }

  if (options.endpoint === '/v1/generate') {
    const payload: Record<string, unknown> = {
      model: options.model,
      prompt: options.prompt || 'Explain edge caching in two sentences.',
      stream: options.stream,
    };
    if (options.systemInstruction?.trim()) {
      payload.systemInstruction = options.systemInstruction.trim();
    }
    if (options.thinkingLevel) {
      payload.thinkingLevel = options.thinkingLevel;
    }

    if (language === 'curl') {
      const streamFlag = options.stream ? ' -N' : '';
      return `curl${streamFlag} -X POST "${cleanBaseUrl}/v1/generate" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(payload, null, 2)}'`;
    }
    if (language === 'python_openai') {
      return `import requests

response = requests.post(
    "${cleanBaseUrl}/v1/generate",
    json=${JSON.stringify(payload, null, 4)},
    stream=${options.stream ? 'True' : 'False'}
)
${
  options.stream
    ? `for line in response.iter_lines(decode_unicode=True):
    if line:
        print(line)`
    : `print(response.json()["text"])`
}`;
    }
    return `const response = await fetch("${cleanBaseUrl}/v1/generate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(${JSON.stringify(payload, null, 2)}),
});
${
  options.stream
    ? `const reader = response.body!.getReader();
const decoder = new TextDecoder();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  console.log(decoder.decode(value));
}`
    : `const data = await response.json();
console.log(data.text);`
}`;
  }

  // Default: /v1/chat/completions (OpenAI-compatible)
  const messages: Array<{ role: string; content: string }> = [];
  if (systemEscaped) {
    messages.push({ role: 'system', content: options.systemInstruction!.trim() });
  }
  messages.push({
    role: 'user',
    content: options.prompt || 'Explain edge caching in two sentences.',
  });

  const chatPayload: Record<string, unknown> = {
    model: options.model,
    messages,
    stream: options.stream,
  };
  if (options.thinkingLevel) {
    chatPayload.thinking_level = options.thinkingLevel;
  }

  if (language === 'curl') {
    const streamFlag = options.stream ? ' -N' : '';
    return `curl${streamFlag} -X POST "${cleanBaseUrl}/v1/chat/completions" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(chatPayload, null, 2)}'`;
  }

  if (language === 'python_openai') {
    return `from openai import OpenAI

client = OpenAI(
    base_url="${cleanBaseUrl}/v1",
    api_key="public-gateway"
)

response = client.chat.completions.create(
    model="${options.model}",
    messages=${JSON.stringify(messages, null, 4)},
    stream=${options.stream ? 'True' : 'False'}
)
${
  options.stream
    ? `for chunk in response:
    delta = chunk.choices[0].delta.content
    if delta:
        print(delta, end="", flush=True)`
    : `print(response.choices[0].message.content)`
}`;
  }

  return `const response = await fetch("${cleanBaseUrl}/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(${JSON.stringify(chatPayload, null, 2)}),
});
${
  options.stream
    ? `const reader = response.body!.getReader();
const decoder = new TextDecoder();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  console.log(decoder.decode(value));
}`
    : `const data = await response.json();
console.log(data.choices[0].message.content);`
}`;
}
