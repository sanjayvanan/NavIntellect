import { ApiError, FunctionCallingConfigMode, GoogleGenAI } from '@google/genai';
import { logger } from '../shared/logger.js';
import { CopilotError, type ModelClient } from './copilot.js';
import { TOOL_DECLARATIONS } from './tools.js';

const TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 1500;

/** Gemini errors worth one retry: overloaded or a passing server error (not limits or bad keys). */
const isTransient = (err: unknown) => err instanceof ApiError && [500, 502, 503].includes(err.status);

/** ModelClient backed by the Gemini API (server side only: the key never reaches the browser). */
export function geminiClient(apiKey: string, model: string): ModelClient {
  const ai = new GoogleGenAI({ apiKey });
  return {
    async generate({ contents, systemInstruction, allowTools, tools = true, json, maxTokens }) {
      // Gemini's free tier is sometimes briefly overloaded ("high demand", 503): try once more.
      for (let attempt = 0; ; attempt++) {
        try {
          const res = await ai.models.generateContent({
            model,
            contents,
            config: {
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
            },
          });
          return {
            functionCalls: res.functionCalls,
            text: res.text,
            content: res.candidates?.[0]?.content,
            tokens: res.usageMetadata?.totalTokenCount ?? 0,
          };
        } catch (err) {
          if (attempt === 0 && isTransient(err)) {
            logger.warn({ status: (err as ApiError).status }, 'gemini busy, retrying once');
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
            continue;
          }
          throw toCopilotError(err, model);
        }
      }
    },
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
