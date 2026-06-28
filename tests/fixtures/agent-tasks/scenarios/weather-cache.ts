import { buildSystemContext, type AgentTaskScenario } from "../types.js";

const artifacts = {
  forecast: `export interface Forecast {
  city: string;
  date: string;
  highC: number;
  lowC: number;
  conditions: string;
}

export function createForecast(city: string, date: string, highC: number, lowC: number, conditions: string): Forecast {
  return { city, date, highC, lowC, conditions };
}`,
  client: `import type { Forecast } from "./forecast.js";

export interface WeatherClient {
  fetchForecast(city: string, days: number): Promise<Forecast[]>;
}

export class MockWeatherClient implements WeatherClient {
  async fetchForecast(city: string, days: number): Promise<Forecast[]> {
    return Array.from({ length: days }, (_, i) => ({
      city,
      date: \`2026-07-\${String(i + 1).padStart(2, "0")}\`,
      highC: 20 + i,
      lowC: 10 + i,
      conditions: i % 2 === 0 ? "sunny" : "cloudy",
    }));
  }
}`,
  cache: `import type { Forecast } from "./forecast.js";

export class ForecastCache {
  private store = new Map<string, { data: Forecast[]; expiresAt: number }>();

  get(key: string): Forecast[] | null {
    const entry = this.store.get(key);
    if (!entry || Date.now() > entry.expiresAt) return null;
    return entry.data;
  }

  set(key: string, data: Forecast[], ttlMs: number): void {
    this.store.set(key, { data, expiresAt: Date.now() + ttlMs });
  }
}`,
  aggregator: `import type { Forecast } from "./forecast.js";
import type { WeatherClient } from "./client.js";
import { ForecastCache } from "./cache.js";

export async function getForecast(
  client: WeatherClient,
  cache: ForecastCache,
  city: string,
  days: number,
  ttlMs = 300_000,
): Promise<Forecast[]> {
  const key = \`\${city}:\${days}\`;
  const cached = cache.get(key);
  if (cached) return cached;
  const data = await client.fetchForecast(city, days);
  cache.set(key, data, ttlMs);
  return data;
}`,
  service: `import { MockWeatherClient } from "./client.js";
import { ForecastCache } from "./cache.js";
import { getForecast } from "./aggregator.js";
import type { Forecast } from "./forecast.js";

export class WeatherService {
  private client = new MockWeatherClient();
  private cache = new ForecastCache();

  async forecast(city: string, days = 5): Promise<Forecast[]> {
    return getForecast(this.client, this.cache, city, days);
  }

  clearCache(): void {
    this.cache = new ForecastCache();
  }
}`,
  tests: `import { describe, it, expect } from "vitest";
import { ForecastCache } from "./cache.js";
import { MockWeatherClient } from "./client.js";
import { getForecast } from "./aggregator.js";

describe("Weather cache", () => {
  it("caches forecast responses", async () => {
    const client = new MockWeatherClient();
    const cache = new ForecastCache();
    const a = await getForecast(client, cache, "Paris", 3);
    const b = await getForecast(client, cache, "Paris", 3);
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
  });
});`,
};

export const weatherCacheScenario: AgentTaskScenario = {
  id: "weather-cache",
  name: "Weather Forecast Aggregator",
  domain: "Cached weather API client",
  systemContext: buildSystemContext("Weather Service", "TypeScript + fetch", "redis stub, metrics"),
  turns: [
    { id: "t01", label: "Forecast model", userMessage: "Forecast type with city, date, highC, lowC, conditions.", artifact: "forecast" },
    { id: "t02", label: "API client", userMessage: "WeatherClient interface and MockWeatherClient.", artifact: "client" },
    { id: "t03", label: "TTL cache", userMessage: "ForecastCache with get/set and expiry.", artifact: "cache" },
    { id: "t04", label: "Duplicate forecast", userMessage: "Forecast type with city, date, highC, lowC, conditions.", artifact: "forecast" },
    { id: "t05", label: "Paraphrase cache", userMessage: "In-memory forecast store with TTL expiration.", artifact: "cache" },
    { id: "t06", label: "Aggregator", userMessage: "getForecast checks cache then calls client.", artifact: "aggregator" },
    { id: "t07", label: "Paraphrase client", userMessage: "Mock weather provider returning N-day forecasts.", artifact: "client" },
    { id: "t08", label: "Weather service", userMessage: "WeatherService exposing forecast and clearCache.", artifact: "service" },
    { id: "t09", label: "Duplicate cache", userMessage: "ForecastCache with get/set and expiry.", artifact: "cache" },
    { id: "t10", label: "Tests", userMessage: "Vitest proving cache hit avoids refetch.", artifact: "tests" },
  ],
  artifacts,
  minCacheHits: 4,
  validateArtifacts(artifacts) {
    const notes: string[] = [];
    if (!artifacts.service?.includes("WeatherService")) notes.push("Missing WeatherService");
    if (!artifacts.cache?.includes("ForecastCache")) notes.push("Missing ForecastCache");
    return { valid: notes.length === 0, notes };
  },
};
