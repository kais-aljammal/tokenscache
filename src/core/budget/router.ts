import type { BudgetAction, ChatRequest } from "../types.js";

export interface ModelRouterOptions {
  downgradeMap?: Record<string, string>;
}

/**
 * Route requests to cheaper models when budget policy requires downgrade.
 */
export class ModelRouter {
  private readonly downgradeMap: Record<string, string>;

  constructor(options: ModelRouterOptions = {}) {
    this.downgradeMap = {
      "anthropic:claude-3-opus": "claude-3-5-haiku-latest",
      "anthropic:claude-3-sonnet": "claude-3-5-haiku-latest",
      "openai:gpt-4o": "gpt-4o-mini",
      "openai:o1": "gpt-4o-mini",
      "google:gemini-2.0-pro": "gemini-2.0-flash",
      "google:gemini-1.5-pro": "gemini-2.0-flash",
      ...options.downgradeMap,
    };
  }

  route(request: ChatRequest, action: BudgetAction | null): ChatRequest {
    if (action !== "downgrade") return request;

    const key = `${request.provider.toLowerCase()}:${normalizeModelKey(request.model)}`;
    const downgraded = this.downgradeMap[key];
    if (!downgraded) {
      return {
        ...request,
        model: this.fallbackDowngrade(request.provider, request.model),
        metadata: { ...request.metadata, routedBy: "ModelRouter" },
      };
    }

    return {
      ...request,
      model: downgraded,
      metadata: { ...request.metadata, routedBy: "ModelRouter", routedFrom: request.model },
    };
  }

  getCheapestModel(provider: string, currentModel: string): string {
    const routed = this.route(
      { provider, model: currentModel, messages: [] },
      "downgrade",
    );
    return routed.model;
  }

  private fallbackDowngrade(provider: string, model: string): string {
    const key = provider.toLowerCase();
    const normalized = model.toLowerCase();
    if (key === "anthropic" && (normalized.includes("opus") || normalized.includes("sonnet"))) {
      return "claude-3-5-haiku-latest";
    }
    if (key === "openai" && !normalized.includes("mini") && !normalized.includes("nano")) {
      return "gpt-4o-mini";
    }
    if ((key === "google" || key === "gemini") && normalized.includes("pro")) {
      return "gemini-2.0-flash";
    }
    return model;
  }
}

function normalizeModelKey(model: string): string {
  return model.toLowerCase().replace(/-latest$/, "");
}
