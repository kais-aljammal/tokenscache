import OpenAI from "openai";
import type { ChatRequest, ChatResponse, TokenUsage } from "../types.js";
import { ProviderAdapter, type ProviderAdapterConfig } from "./base.js";

export class OpenAIProvider extends ProviderAdapter {
  private client: OpenAI | null = null;

  constructor(config: ProviderAdapterConfig = {}) {
    super("openai", config);
  }

  private getClient(): OpenAI {
    if (!this.client) {
      this.client = new OpenAI({
        apiKey: this.requireApiKey(),
        baseURL: this.config.baseUrl,
      });
    }
    return this.client;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const response = await this.getClient().chat.completions.create({
      model: request.model,
      messages: request.messages
        .filter((m) => m.role !== "tool")
        .map((m) => ({
          role: m.role as "system" | "user" | "assistant",
          content: m.content,
        })),
      tools: request.tools as OpenAI.Chat.Completions.ChatCompletionTool[] | undefined,
      stream: false,
    });

    const choice = response.choices[0];
    return {
      id: response.id,
      content: choice?.message?.content ?? "",
      model: response.model,
      usage: this.normalizeUsage(response.usage),
      cached: false,
    };
  }

  getCheapestModel(currentModel: string): string {
    const model = currentModel.toLowerCase();
    if (model.includes("mini") || model.includes("nano")) return currentModel;
    return "gpt-4o-mini";
  }

  normalizeUsage(raw: unknown): TokenUsage {
    const usage = raw as {
      prompt_tokens?: number;
      completion_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
    };

    return {
      inputTokens: usage.prompt_tokens ?? 0,
      outputTokens: usage.completion_tokens ?? 0,
      cacheReadTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
    };
  }
}
