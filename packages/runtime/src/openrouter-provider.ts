// Nexus Runtime — OpenRouter LLM Provider
// 支持所有主流模型 (Claude/GPT/Gemini/等) via OpenRouter 统一API
// MIT License

import { Effect, Context } from "effect";
import { MODEL_PRICING } from "../../core/src/effects/nexus-context.js";
import type { Message, LLMResponse, ModelProvider } from "../../core/src/agent.js";

export interface OpenRouterConfig {
  apiKey: string;
  defaultModel?: string;
  baseUrl?: string;
}

export const OpenRouterConfig = Context.GenericTag<OpenRouterConfig>("OpenRouterConfig");

interface OpenRouterChoice {
  message: {
    role: string;
    content: string;
  };
  finish_reason: string;
}

interface OpenRouterResponse {
  id: string;
  model: string;
  choices: OpenRouterChoice[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  error?: {
    message: string;
    code: string;
  };
}

export function makeOpenRouterProvider(config: OpenRouterConfig): ModelProvider {
  const baseUrl = config.baseUrl || "https://openrouter.ai/api/v1";

  async function chatCompletion(
    messages: Message[],
    options?: {
      model?: string;
      maxTokens?: number;
      temperature?: number;
    }
  ): Promise<LLMResponse> {
    const model = options?.model || config.defaultModel || "anthropic/claude-3-haiku";
    const maxTokens = options?.maxTokens || 4096;
    const temperature = options?.temperature ?? 0.7;

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`,
        "HTTP-Referer": "https://github.com/sundaylovehtc-creator/nexus-ai",
        "X-Title": "Nexus AI Agent",
      },
      body: JSON.stringify({
        model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        max_tokens: maxTokens,
        temperature,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error ${response.status}: ${errorText}`);
    }

    const data = await response.json() as OpenRouterResponse;

    if (data.error) {
      throw new Error(`OpenRouter error: ${data.error.message} (code: ${data.error.code})`);
    }

    const choice = data.choices[0];
    if (!choice) {
      throw new Error("No completion choices returned");
    }

    return {
      content: choice.message.content,
      usage: {
        input: data.usage.prompt_tokens,
        output: data.usage.completion_tokens,
      },
      model: data.model,
    };
  }

  return {
    generate(messages, options) {
      return Effect.tryPromise({
        try: () => chatCompletion(messages, options),
        catch: (e) => e instanceof Error ? e : new Error(String(e)),
      });
    },
  };
}

// Model list for OpenRouter
export const OPENROUTER_MODELS = {
  // Anthropic
  "claude-3.5-sonnet": { id: "anthropic/claude-3.5-sonnet", contextWindow: 200_000 },
  "claude-3-opus": { id: "anthropic/claude-3-opus", contextWindow: 200_000 },
  "claude-3-haiku": { id: "anthropic/claude-3-haiku", contextWindow: 200_000 },
  // OpenAI
  "gpt-4o": { id: "openai/gpt-4o", contextWindow: 128_000 },
  "gpt-4o-mini": { id: "openai/gpt-4o-mini", contextWindow: 128_000 },
  "gpt-4-turbo": { id: "openai/gpt-4-turbo", contextWindow: 128_000 },
  // Google
  "gemini-1.5-pro": { id: "google/gemini-1.5-pro", contextWindow: 1_000_000 },
  "gemini-1.5-flash": { id: "google/gemini-1.5-flash", contextWindow: 1_000_000 },
  // DeepSeek
  "deepseek-chat": { id: "deepseek/deepseek-chat", contextWindow: 64_000 },
  // Mistral
  "mistral-large": { id: "mistralai/mistral-large", contextWindow: 32_000 },
  // Meta
  "llama-3-70b": { id: "meta-llama/llama-3-70b-instruct", contextWindow: 128_000 },
  "llama-3-8b": { id: "meta-llama/llama-3-8b-instruct", contextWindow: 128_000 },
  // Cheap options
  "qwen-2.5-72b": { id: "qwen/qwen-2.5-72b-instruct", contextWindow: 32_000 },
  "phi-3-medium": { id: "microsoft/phi-3-medium", contextWindow: 128_000 },
} as const;

export type OpenRouterModelId = keyof typeof OPENROUTER_MODELS;
