import { ApiError, FunctionCallingConfigMode, GoogleGenAI, type GenerateContentConfig, type GenerateContentResponseUsageMetadata } from '@google/genai';
import { logger } from '../shared/logger.js';
import { CopilotError, type GenerateRequest, type ModelClient } from './copilot.js';
import { TOOL_DECLARATIONS } from './tools.js';

const TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 1500;

/** Gemini errors worth one retry: overloaded or a passing server error (not limits or bad keys). */
const isTransient = (err: unknown) => err instanceof ApiError && [500, 502, 503].includes(err.status);

function configFor({ systemInstruction, allowTools, tools = true, json, maxTokens }: GenerateRequest): GenerateContentConfig {
  return {
    systemInstruction,
    ...(tools
      ? {
          tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
          // Last round: answer with what is known, no more tool calls.
          toolConfig: { functionCallingConfig: { mode: allowTools ? FunctionCallingConfigMode.AUTO : FunctionCallingConfigMode.NONE } },
        }
      : {}),
    // Structured output: the reply is JSON matching this schema.
    ...(json ? { responseMimeType: 'application/json', responseJsonSchema: json } : {}),
    temperature: 0.2,
    maxOutputTokens: maxTokens ?? 1024,
    abortSignal: AbortSignal.timeout(TIMEOUT_MS),
  };
}

const usageOf = (u: GenerateContentResponseUsageMetadata | undefined) => ({
  tokens: u?.totalTokenCount ?? 0,
  usage: { prompt: u?.promptTokenCount ?? 0, output: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0) },
});

/** ModelClient backed by the Gemini API (server side only: the key never reaches the browser). */
export function geminiClient(apiKey: string, model: string): ModelClient {
  const ai = new GoogleGenAI({ apiKey });

  /** Runs `call`; Gemini's free tier is sometimes briefly overloaded ("high demand", 503): try once more. */
  async function withRetry<T>(call: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await call();
      } catch (err) {
        if (attempt === 0 && isTransient(err)) {
          logger.warn({ status: (err as ApiError).status }, 'gemini busy, retrying once');
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
        throw toCopilotError(err, model);
      }
    }
  }

  return {
    generate: (req) =>
      withRetry(async () => {
        const res = await ai.models.generateContent({ model, contents: req.contents, config: configFor(req) });
        return { functionCalls: res.functionCalls, text: res.text, content: res.candidates?.[0]?.content, ...usageOf(res.usageMetadata) };
      }),
  };
}

function toCopilotError(err: unknown, model: string): Error {
  if (err instanceof ApiError) {
    logger.warn({ status: err.status, msg: err.message.slice(0, 300) }, 'gemini error');
    if (err.status === 429) return new CopilotError(429, 'Gemini free-tier limit reached. Try again in a minute.', 60);
    if (err.status === 401 || err.status === 403) return new CopilotError(503, 'The Gemini API key was rejected. Check GEMINI_API_KEY.');
    if (err.status === 404) return new CopilotError(503, `Gemini model "${model}" is not available. Set GEMINI_MODEL to a current model.`);
    if (err.status >= 500) return new CopilotError(503, 'Gemini is busy right now (high demand). Try again in a minute.');
    return new CopilotError(502, 'Gemini could not process this request.');
  }
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return new CopilotError(504, 'Gemini took too long to answer. Try again.');
  }
  return err instanceof Error ? err : new Error(String(err));
}
