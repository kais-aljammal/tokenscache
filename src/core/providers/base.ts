import type { ChatRequest, ChatResponse, TokenUsage } from "../types.js";

export interface ProviderAdapterConfig {
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Base interface for all provider adapters.
 * All providers must implement chat completion with usage tracking.
 */
export abstract class ProviderAdapter {
  readonly name: string;
  protected readonly config: ProviderAdapterConfig;

  constructor(name: string, config: ProviderAdapterConfig) {
    this.name = name;
    this.config = config;
  }

  /**
   * Send a chat completion request to the upstream provider.
   */
  abstract chat(request: ChatRequest): Promise<ChatResponse>;

  /**
   * Return the cheapest model tier in this provider's family for downgrade routing.
   */
  abstract getCheapestModel(currentModel: string): string;

  /**
   * Normalize raw provider usage fields into TokenGuard's unified format.
   */
  abstract normalizeUsage(raw: unknown): TokenUsage;

  /**
   * Validate API key is present before making requests.
   */
  protected requireApiKey(): string {
    if (!this.config.apiKey) {
      throw new Error(`[TokenGuard] API key required for provider: ${this.name}`);
    }
    return this.config.apiKey;
  }

  /** Configured upstream base URL, if any. */
  getBaseUrl(): string | undefined {
    return this.config.baseUrl;
  }
}

export type ProviderFactory = (config: ProviderAdapterConfig) => ProviderAdapter;
