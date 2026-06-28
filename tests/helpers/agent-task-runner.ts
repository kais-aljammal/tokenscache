import { TokenGuard } from "../../src/index.js";
import { ProviderAdapter, type ProviderAdapterConfig } from "../../src/core/providers/base.js";
import type { ChatRequest, ChatResponse, TokenUsage } from "../../src/core/types.js";
import {
  buildMessages,
  estimateRequestTokens,
  estimateTokens,
  type AgentTaskScenario,
} from "../fixtures/agent-tasks/types.js";

export interface MeterSnapshot {
  upstreamCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface TaskRunResult {
  mode: "with-tokenguard" | "without-tokenguard";
  upstreamCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheHits: number;
  cacheMisses: number;
  artifacts: Record<string, string>;
}

export class ScenarioMockProvider extends ProviderAdapter {
  private calls = 0;
  private inputTokens = 0;
  private outputTokens = 0;

  constructor(
    private readonly artifactCode: Record<string, string>,
    config: ProviderAdapterConfig = {},
  ) {
    super("mock", config);
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const artifact = (request.metadata?.artifact as string) ?? Object.keys(this.artifactCode)[0]!;
    const code = this.artifactCode[artifact] ?? "// unknown artifact";
    const input = estimateRequestTokens(request.messages);
    const output = estimateTokens(code);

    this.calls += 1;
    this.inputTokens += input;
    this.outputTokens += output;

    return {
      id: `mock-${this.calls}`,
      content: code,
      model: request.model,
      usage: { inputTokens: input, outputTokens: output },
      cached: false,
    };
  }

  getCheapestModel(currentModel: string): string {
    return currentModel;
  }

  normalizeUsage(raw: unknown): TokenUsage {
    return raw as TokenUsage;
  }

  snapshot(): MeterSnapshot {
    return {
      upstreamCalls: this.calls,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      totalTokens: this.inputTokens + this.outputTokens,
    };
  }
}

export async function runWithTokenGuard(
  scenario: AgentTaskScenario,
  dbPath = ":memory:",
): Promise<TaskRunResult> {
  const provider = new ScenarioMockProvider(scenario.artifacts);
  const guard = new TokenGuard({
    config: {
      providers: { mock: {} },
      cache: {
        l1: { maxEntries: 300 },
        agentArtifactScope: true,
        semantic: {
          highThreshold: 0.85,
          grayZoneMin: 0.65,
          matchPolicy: "verified-decision",
        },
      },
      optimizer: {
        toolPruning: true,
        historyCompression: false,
        outputShaping: false,
        cacheAlignment: false,
      },
    },
    sessionId: `task-${scenario.id}`,
    dbPath,
  });

  guard.registerProvider(provider);
  const artifacts: Record<string, string> = {};

  for (const turn of scenario.turns) {
    const response = await guard.chat({
      provider: "mock",
      model: "gpt-4o-mini",
      messages: buildMessages(scenario, turn),
      metadata: { artifact: turn.artifact, turnId: turn.id },
    });
    artifacts[turn.artifact] = response.content;
  }

  const stats = guard.getCacheStats();
  const meter = provider.snapshot();
  guard.close();

  return {
    mode: "with-tokenguard",
    upstreamCalls: meter.upstreamCalls,
    inputTokens: meter.inputTokens,
    outputTokens: meter.outputTokens,
    totalTokens: meter.totalTokens,
    cacheHits: stats.hits,
    cacheMisses: stats.misses,
    artifacts,
  };
}

export async function runWithoutTokenGuard(scenario: AgentTaskScenario): Promise<TaskRunResult> {
  const provider = new ScenarioMockProvider(scenario.artifacts);
  const artifacts: Record<string, string> = {};

  for (const turn of scenario.turns) {
    const response = await provider.chat({
      provider: "mock",
      model: "gpt-4o-mini",
      messages: buildMessages(scenario, turn),
      metadata: { artifact: turn.artifact, turnId: turn.id },
    });
    artifacts[turn.artifact] = response.content;
  }

  const meter = provider.snapshot();

  return {
    mode: "without-tokenguard",
    upstreamCalls: meter.upstreamCalls,
    inputTokens: meter.inputTokens,
    outputTokens: meter.outputTokens,
    totalTokens: meter.totalTokens,
    cacheHits: 0,
    cacheMisses: scenario.turns.length,
    artifacts,
  };
}

export function artifactsIdentical(
  a: Record<string, string>,
  b: Record<string, string>,
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if ((a[k] ?? "").trim() !== (b[k] ?? "").trim()) return false;
  }
  return true;
}
