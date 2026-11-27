import { ApiError, FunctionCallingConfigMode, GoogleGenAI, type FunctionCall, type GenerateContentConfig, type GenerateContentResponseUsageMetadata, type Part } from '@google/genai';
import { logger } from '../shared/logger.js';
import { CopilotError, type GenerateRequest, type ModelClient } from './copilot.js';
import type { Embedder } from './knowledge.js';
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
  async function withRetry<T>(call: () => Promise<T>, canRetry: () => boolean = () => true): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await call();
      } catch (err) {
        if (attempt === 0 && isTransient(err) && canRetry()) {
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

    // Streams the answer text. The model turn is rebuilt from every part received (thought
    // signatures included, which the API needs back on the next round).
    stream(req, onText) {
      let sentText = false;
      return withRetry(
        async () => {
          const it = await ai.models.generateContentStream({ model, contents: req.contents, config: configFor(req) });
          const parts: Part[] = [];
          const calls: FunctionCall[] = [];
          let text = '';
          let meta: GenerateContentResponseUsageMetadata | undefined;
          for await (const chunk of it) {
            for (const p of chunk.candidates?.[0]?.content?.parts ?? []) {
              parts.push(p);
              if (p.functionCall) calls.push(p.functionCall);
              if (p.text && !p.thought) {
                text += p.text;
                sentText = true;
                onText(p.text);
              }
            }
            if (chunk.usageMetadata) meta = chunk.usageMetadata;
          }
          return { functionCalls: calls.length ? calls : undefined, text, content: { role: 'model', parts }, ...usageOf(meta) };
        },
        () => !sentText, // once text reached the user, a retry would repeat it
      );
    },
  };
}

/** Gemini embeddings for the knowledge base: separate task types for documents and questions. */
export function geminiEmbedder(apiKey: string, model: string, dims = 768): Embedder {
  const ai = new GoogleGenAI({ apiKey });
  return {
    model: `${model}@${dims}`,
    dims,
    // Starting point for gemini-embedding at 768 dimensions; check it against the knowledge evals.
    maxDistance: 0.6,
    async embed(texts, kind) {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += 100) {
        const res = await ai.models.embedContent({
          model,
          contents: texts.slice(i, i + 100),
          config: { taskType: kind === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT', outputDimensionality: dims, abortSignal: AbortSignal.timeout(TIMEOUT_MS) },
        });
        const vectors = (res.embeddings ?? []).map((e) => e.values ?? []);
        if (vectors.length !== Math.min(100, texts.length - i) || vectors.some((v) => v.length !== dims)) {
          throw new Error(`embedding: expected ${dims}-dimension vectors from ${model}`);
        }
        out.push(...vectors);
      }
      return out;
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
