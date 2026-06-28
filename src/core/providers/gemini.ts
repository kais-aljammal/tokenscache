import { GoogleGenerativeAI } from "@google/generative-ai";
import type { ChatRequest, ChatResponse, TokenUsage } from "../types.js";
import { ProviderAdapter, type ProviderAdapterConfig } from "./base.js";

export class GeminiProvider extends ProviderAdapter {
  private client: GoogleGenerativeAI | null = null;

  constructor(config: ProviderAdapterConfig = {}) {
    super("google", config);
  }

  private getClient(): GoogleGenerativeAI {
    if (!this.client) {
      this.client = new GoogleGenerativeAI(this.requireApiKey());
    }
    return this.client;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const model = this.getClient().getGenerativeModel({ model: request.model });
    const history = request.messages.slice(0, -1).map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
    const latest = request.messages[request.messages.length - 1];

    const chat = model.startChat({ history });
    const result = await chat.sendMessage(latest?.content ?? "");
    const response = result.response;
    const content = response.text();

    return {
      id: crypto.randomUUID(),
      content,
      model: request.model,
      usage: this.normalizeUsage(response.usageMetadata),
      cached: false,
    };
  }

  getCheapestModel(currentModel: string): string {
    const model = currentModel.toLowerCase();
    if (model.includes("lite")) return currentModel;
    if (model.includes("flash")) return "gemini-2.0-flash-lite";
    return "gemini-2.0-flash";
  }

  normalizeUsage(raw: unknown): TokenUsage {
    const usage = raw as {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      cachedContentTokenCount?: number;
    };

    return {
      inputTokens: usage.promptTokenCount ?? 0,
      outputTokens: usage.candidatesTokenCount ?? 0,
      cacheReadTokens: usage.cachedContentTokenCount ?? 0,
    };
  }
}
