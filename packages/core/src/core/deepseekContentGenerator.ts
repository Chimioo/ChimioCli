/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  CountTokensParameters,
  CountTokensResponse,
  Content,
  EmbedContentParameters,
  EmbedContentResponse,
  FunctionDeclaration,
  GenerateContentParameters,
  GenerateContentResponse,
  Part,
} from '@google/genai';
import type { ContentGenerator } from './contentGenerator.js';

type DeepSeekTool = {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

type DeepSeekMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string }
  | { role: 'assistant'; content: string; tool_calls: DeepSeekToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string };

type DeepSeekToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

type DeepSeekChatCompletionResponse = {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: DeepSeekToolCall[];
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

type DeepSeekChatCompletionStreamChunk = {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: Array<{
    index: number;
    delta?: {
      role?: 'assistant';
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: 'function';
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
};

function getProviderFromEnv(): string {
  return (process.env['GEMINI_CLI_PROVIDER'] || '').toLowerCase();
}

function getDeepSeekBaseUrl(): string {
  const provider = getProviderFromEnv();
  if (provider === 'openai_compatible') {
    return process.env['OPENAI_COMPAT_BASE_URL'] || 'https://api.openai.com/v1';
  }
  return process.env['DEEPSEEK_BASE_URL'] || 'https://api.deepseek.com';
}

function getDeepSeekApiKey(): string {
  const provider = getProviderFromEnv();
  const key =
    provider === 'openai_compatible'
      ? process.env['OPENAI_COMPAT_API_KEY']
      : process.env['DEEPSEEK_API_KEY'];
  if (!key) {
    const err = new Error(
      provider === 'openai_compatible'
        ? 'OpenAI-compatible API key is required when GEMINI_CLI_PROVIDER=openai_compatible.'
        : 'DeepSeek API key is required when GEMINI_CLI_PROVIDER=deepseek.',
    ) as Error & { code?: number };
    err.code = 401;
    throw err;
  }
  return key;
}

function joinUrl(base: string, path: string): string {
  const baseTrimmed = base.replace(/\/+$/, '');
  const pathTrimmed = path.replace(/^\/+/, '');
  return `${baseTrimmed}/${pathTrimmed}`;
}

function isDeepSeekEnabled(): boolean {
  const provider = getProviderFromEnv();
  if (provider === 'deepseek') {
    return true;
  }
  if (provider === 'openai_compatible') {
    return true;
  }
  if (provider) {
    return false;
  }
  // Auto-detect provider when none is specified.
  // Prefer DeepSeek if its key is present and Gemini key is not.
  return !!process.env['DEEPSEEK_API_KEY'] && !process.env['GEMINI_API_KEY'];
}

function resolveDeepSeekModel(requestModel: string | undefined): string {
  const provider = getProviderFromEnv();
  const envModel =
    provider === 'openai_compatible'
      ? process.env['OPENAI_COMPAT_MODEL']
      : process.env['DEEPSEEK_MODEL'];
  if (envModel) {
    return envModel;
  }
  if (requestModel && requestModel.startsWith('deepseek-')) {
    return requestModel;
  }
  if (provider === 'openai_compatible') {
    return 'gpt-4o-mini';
  }
  return 'deepseek-chat';
}

function resolveOpenAICompatTemperature(): number | undefined {
  const provider = getProviderFromEnv();
  if (provider !== 'openai_compatible') {
    return undefined;
  }
  const raw = process.env['OPENAI_COMPAT_TEMPERATURE'];
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

function createGeminiStreamTextChunk(text: string): GenerateContentResponse {
  return {
    candidates: [
      {
        content: {
          role: 'model',
          parts: [{ text }],
        },
      },
    ],
  } as unknown as GenerateContentResponse;
}

function createGeminiStreamToolCallsChunk(
  toolCalls: DeepSeekToolCall[],
): GenerateContentResponse {
  const parts: Part[] = [];
  for (const tc of toolCalls) {
    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = tc.function.arguments
        ? (JSON.parse(tc.function.arguments) as Record<string, unknown>)
        : {};
    } catch {
      parsedArgs = { __raw: tc.function.arguments };
    }
    parts.push({
      functionCall: {
        id: tc.id,
        name: tc.function.name,
        args: parsedArgs,
      },
    } as unknown as Part);
  }

  return {
    candidates: [
      {
        content: {
          role: 'model',
          parts,
        },
      },
    ],
  } as unknown as GenerateContentResponse;
}

function partToText(part: Part): string {
  if (typeof part.text === 'string') {
    return part.text;
  }
  // Minimal fallback for non-text parts.
  return JSON.stringify(part);
}

function contentPartsToText(parts: Part[] | undefined): string {
  if (!parts || parts.length === 0) {
    return '';
  }
  return parts.map(partToText).join('');
}

function normalizeSystemInstruction(systemInstruction: unknown): string | null {
  if (!systemInstruction) {
    return null;
  }
  if (typeof systemInstruction === 'string') {
    return systemInstruction;
  }

  // Gemini SDK allows passing Content / Part / Part[] here; we only support text extraction.
  const si = systemInstruction as { parts?: Part[] };
  if (Array.isArray(si?.parts)) {
    return contentPartsToText(si.parts);
  }

  // If it's a Part
  const maybePart = systemInstruction as Part;
  if (maybePart && typeof maybePart === 'object' && 'text' in maybePart) {
    return partToText(maybePart);
  }

  // If it's a Part[]
  if (Array.isArray(systemInstruction)) {
    return contentPartsToText(systemInstruction as Part[]);
  }

  return null;
}

function convertFunctionDeclarationsToDeepSeekTools(
  functionDeclarations: FunctionDeclaration[] | undefined,
): DeepSeekTool[] | undefined {
  if (!functionDeclarations || functionDeclarations.length === 0) {
    return undefined;
  }
  const tools: DeepSeekTool[] = [];
  for (const fn of functionDeclarations) {
    if (!fn.name) {
      continue;
    }
    tools.push({
      type: 'function',
      function: {
        name: fn.name,
        description: fn.description,
        parameters: (fn.parameters as unknown as Record<string, unknown>) || {
          type: 'object',
          properties: {},
        },
      },
    });
  }

  return tools.length > 0 ? tools : undefined;
}

function geminiRequestToDeepSeekMessages(
  request: GenerateContentParameters,
): { messages: DeepSeekMessage[]; tools?: DeepSeekTool[] } {
  const systemInstructionText = normalizeSystemInstruction(
    (request.config as { systemInstruction?: unknown } | undefined)
      ?.systemInstruction,
  );

  const toolsConfig = request.config as
    | { tools?: Array<{ functionDeclarations?: FunctionDeclaration[] }> }
    | undefined;
  const functionDeclarations = toolsConfig?.tools?.[0]?.functionDeclarations;
  const tools = convertFunctionDeclarationsToDeepSeekTools(functionDeclarations);

  const messages: DeepSeekMessage[] = [];
  if (systemInstructionText) {
    messages.push({ role: 'system', content: systemInstructionText });
  }

  const isContent = (value: unknown): value is Content =>
    !!value && typeof value === 'object' && 'role' in value && 'parts' in value;

  const rawContents = request.contents;
  const normalizedContents: Content[] = Array.isArray(rawContents)
    ? rawContents.filter(isContent)
    : isContent(rawContents)
      ? [rawContents]
      : [];

  for (const content of normalizedContents) {
    const role = content.role;
    const parts = content.parts;

    if (role === 'user') {
      // Tool results are encoded as role=user with functionResponse parts.
      const functionResponses = (parts ?? []).filter((p) => !!p.functionResponse);
      if (functionResponses.length > 0) {
        for (const frPart of functionResponses) {
          const fr = frPart.functionResponse!;
          const toolCallId =
            fr.id ??
            `${fr.name ?? 'tool'}_${Math.random().toString(16).slice(2)}`;
          const payload = fr.response ?? {};
          // Gemini uses {output: string} convention in many places.
          const output =
            typeof (payload as { output?: unknown }).output === 'string'
              ? String((payload as { output?: unknown }).output)
              : JSON.stringify(payload);
          messages.push({
            role: 'tool',
            tool_call_id: toolCallId,
            content: output,
          });
        }
        continue;
      }

      messages.push({ role: 'user', content: contentPartsToText(parts) });
      continue;
    }

    if (role === 'model') {
      // Model history should generally be assistant messages (text). Any prior functionCalls
      // are represented via tool_calls, but we don't need to send them back explicitly.
      const text = contentPartsToText(parts);
      if (text) {
        messages.push({ role: 'assistant', content: text });
      }
      continue;
    }

    // Unknown role fallback
    messages.push({ role: 'user', content: contentPartsToText(parts) });
  }

  return { messages, ...(tools ? { tools } : {}) };
}

function deepSeekResponseToGeminiResponse(
  resp: DeepSeekChatCompletionResponse,
): GenerateContentResponse {
  const choice = resp.choices?.[0];
  const msg = choice?.message;

  const parts: Part[] = [];

  if (msg?.content) {
    parts.push({ text: msg.content });
  }

  if (msg?.tool_calls && msg.tool_calls.length > 0) {
    for (const tc of msg.tool_calls) {
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = tc.function.arguments
          ? (JSON.parse(tc.function.arguments) as Record<string, unknown>)
          : {};
      } catch {
        // If args are not valid JSON, keep a string to avoid crashing.
        parsedArgs = { __raw: tc.function.arguments };
      }
      parts.push({
        functionCall: {
          id: tc.id,
          name: tc.function.name,
          args: parsedArgs,
        },
      } as unknown as Part);
    }
  }

  // Minimal candidate structure used throughout the codebase.
  return {
    candidates: [
      {
        content: {
          role: 'model',
          parts,
        },
        finishReason: (choice?.finish_reason?.toUpperCase() || 'STOP') as never,
      },
    ],
    usageMetadata:
      resp.usage && typeof resp.usage.total_tokens === 'number'
        ? ({ totalTokenCount: resp.usage.total_tokens } as never)
        : undefined,
  } as unknown as GenerateContentResponse;
}

export class DeepSeekContentGenerator implements ContentGenerator {
  async generateContent(
    request: GenerateContentParameters,
    userPromptId: string,
  ): Promise<GenerateContentResponse> {
    if (!isDeepSeekEnabled()) {
      throw new Error(
        'DeepSeekContentGenerator called but GEMINI_CLI_PROVIDER is not set to deepseek',
      );
    }

    const apiKey = getDeepSeekApiKey();
    const baseUrl = getDeepSeekBaseUrl();

    const endpoint = joinUrl(baseUrl, 'chat/completions');

    const { messages, tools } = geminiRequestToDeepSeekMessages(request);

    const temperature = resolveOpenAICompatTemperature();

    const body = {
      model: resolveDeepSeekModel(request.model),
      messages,
      ...(tools ? { tools } : {}),
      ...(tools ? { tool_choice: 'auto' } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      user: userPromptId,
    };

    const abortSignal = (request.config as { abortSignal?: AbortSignal } | undefined)
      ?.abortSignal;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: abortSignal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `DeepSeek API error (${res.status} ${res.statusText}): ${text}`,
      );
    }

    const json = (await res.json()) as DeepSeekChatCompletionResponse;
    return deepSeekResponseToGeminiResponse(json);
  }

  async generateContentStream(
    request: GenerateContentParameters,
    userPromptId: string,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    if (!isDeepSeekEnabled()) {
      throw new Error(
        'DeepSeekContentGenerator called but GEMINI_CLI_PROVIDER is not set to deepseek',
      );
    }

    const apiKey = getDeepSeekApiKey();
    const baseUrl = getDeepSeekBaseUrl();
    const endpoint = joinUrl(baseUrl, 'chat/completions');

    const { messages, tools } = geminiRequestToDeepSeekMessages(request);

    const abortSignal = (request.config as { abortSignal?: AbortSignal } | undefined)
      ?.abortSignal;

    const body = {
      model: resolveDeepSeekModel(request.model),
      messages,
      ...(tools ? { tools } : {}),
      ...(tools ? { tool_choice: 'auto' } : {}),
      stream: true,
      user: userPromptId,
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: abortSignal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `DeepSeek API error (${res.status} ${res.statusText}): ${text}`,
      );
    }

    if (!res.body) {
      throw new Error('DeepSeek streaming response has no body');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    const toolCallsByIndex = new Map<number, DeepSeekToolCall>();
    let done = false;
    let buffer = '';

    const flushToolCallsIfAny = async function* () {
      const calls = Array.from(toolCallsByIndex.entries())
        .sort(([a], [b]) => a - b)
        .map(([, v]) => v);
      if (calls.length > 0) {
        yield createGeminiStreamToolCallsChunk(calls);
      }
    };

    async function* gen() {
      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          buffer += decoder.decode(value, { stream: true });
        }

        // SSE events are newline-delimited. We parse line-by-line.
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith('data:')) {
            continue;
          }
          const data = line.slice('data:'.length).trim();
          if (!data) {
            continue;
          }
          if (data === '[DONE]') {
            // Emit any pending tool calls before finishing.
            yield* flushToolCallsIfAny();
            return;
          }

          let chunk: DeepSeekChatCompletionStreamChunk;
          try {
            chunk = JSON.parse(data) as DeepSeekChatCompletionStreamChunk;
          } catch {
            // Ignore malformed chunk.
            continue;
          }

          const choice = chunk.choices?.[0];
          const delta = choice?.delta;

          if (delta?.content) {
            yield createGeminiStreamTextChunk(delta.content);
          }

          if (delta?.tool_calls && delta.tool_calls.length > 0) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              const existing = toolCallsByIndex.get(idx);
              const id = tc.id || existing?.id || `call_${idx}`;
              const name =
                tc.function?.name || existing?.function.name || 'tool';
              const argsDelta = tc.function?.arguments || '';
              const args =
                (existing?.function.arguments || '') + (argsDelta || '');
              toolCallsByIndex.set(idx, {
                id,
                type: 'function',
                function: { name, arguments: args },
              });
            }
          }

          if (choice?.finish_reason) {
            // If tool calls are produced, DeepSeek typically ends with finish_reason=tool_calls.
            yield* flushToolCallsIfAny();
          }
        }
      }

      // End-of-stream: flush remaining tool calls.
      yield* flushToolCallsIfAny();
    }

    return gen();
  }

  async countTokens(_request: CountTokensParameters): Promise<CountTokensResponse> {
    // Fallback: we don't call DeepSeek token counting API here.
    // Call sites already fall back to heuristic estimation if this errors.
    throw new Error('countTokens is not supported for DeepSeek provider');
  }

  async embedContent(
    _request: EmbedContentParameters,
  ): Promise<EmbedContentResponse> {
    throw new Error('embedContent is not supported for DeepSeek provider');
  }
}
