import Anthropic from "@anthropic-ai/sdk";
import type { ChatRequest, ChatResponse, TokenUsage } from "../types.js";
import { ProviderAdapter, type ProviderAdapterConfig } from "./base.js";

export class AnthropicProvider extends ProviderAdapter {
  private client: Anthropic | null = null;

  constructor(config: ProviderAdapterConfig = {}) {
    super("anthropic", config);
  }

  private getClient(): Anthropic {
    if (!this.client) {
      this.client = new Anthropic({
        apiKey: this.requireApiKey(),
        baseURL: this.config.baseUrl,
      });
    }
    return this.client;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const systemMessage = request.messages.find((m) => m.role === "system");
    const nonSystem = request.messages.filter((m) => m.role !== "system");

    const response = await this.getClient().messages.create({
      model: request.model,
      max_tokens: 4096,
      system: systemMessage?.content,
      messages: nonSystem.map((m) => ({
        role: m.role === "tool" ? "user" : m.role,
        content: m.content,
      })) as Anthropic.MessageParam[],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    const content = textBlock && "text" in textBlock ? textBlock.text : "";

    return {
      id: response.id,
      content,
      model: response.model,
      usage: this.normalizeUsage(response.usage),
      cached: false,
    };
  }

  getCheapestModel(currentModel: string): string {
    const model = currentModel.toLowerCase();
    if (model.includes("haiku")) return currentModel;
    return "claude-3-5-haiku-latest";
  }

  normalizeUsage(raw: unknown): TokenUsage {
    const usage = raw as {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };

    return {
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    };
  }
}
