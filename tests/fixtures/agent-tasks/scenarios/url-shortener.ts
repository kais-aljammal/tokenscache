import { buildSystemContext, type AgentTaskScenario } from "../types.js";

const artifacts = {
  link: `export interface ShortLink {
  slug: string;
  targetUrl: string;
  createdAt: Date;
  clicks: number;
}

export function createLink(slug: string, targetUrl: string): ShortLink {
  if (!targetUrl.startsWith("http")) throw new Error("Invalid URL");
  return { slug, targetUrl, createdAt: new Date(), clicks: 0 };
}`,
  encoder: `export function encodeSlug(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
}

export function randomSlug(length = 8): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}`,
  registry: `import type { ShortLink } from "./link.js";

export class LinkRegistry {
  private links = new Map<string, ShortLink>();

  register(link: ShortLink): void {
    if (this.links.has(link.slug)) throw new Error("Slug taken");
    this.links.set(link.slug, link);
  }

  resolve(slug: string): ShortLink | undefined { return this.links.get(slug); }
  incrementClicks(slug: string): void {
    const link = this.links.get(slug);
    if (link) link.clicks += 1;
  }
}`,
  analytics: `import type { ShortLink } from "./link.js";

export interface LinkStats {
  slug: string;
  clicks: number;
  targetUrl: string;
}

export function toStats(link: ShortLink): LinkStats {
  return { slug: link.slug, clicks: link.clicks, targetUrl: link.targetUrl };
}`,
  service: `import { createLink } from "./link.js";
import { encodeSlug, randomSlug } from "./encoder.js";
import { LinkRegistry } from "./registry.js";
import { toStats, type LinkStats } from "./analytics.js";

export class UrlShortenerService {
  private registry = new LinkRegistry();

  shorten(targetUrl: string, customSlug?: string): ShortLink {
    const slug = customSlug ? encodeSlug(customSlug) : randomSlug();
    const link = createLink(slug, targetUrl);
    this.registry.register(link);
    return link;
  }

  redirect(slug: string): string {
    const link = this.registry.resolve(slug);
    if (!link) throw new Error("Not found");
    this.registry.incrementClicks(slug);
    return link.targetUrl;
  }

  stats(slug: string): LinkStats {
    const link = this.registry.resolve(slug);
    if (!link) throw new Error("Not found");
    return toStats(link);
  }
}`,
  tests: `import { describe, it, expect } from "vitest";
import { UrlShortenerService } from "./service.js";
import { encodeSlug } from "./encoder.js";

describe("URL shortener", () => {
  it("shortens and redirects", () => {
    const svc = new UrlShortenerService();
    const link = svc.shorten("https://example.com/docs", "docs");
    expect(link.slug).toBe("docs");
    expect(svc.redirect("docs")).toBe("https://example.com/docs");
  });
  it("encodes slugs", () => {
    expect(encodeSlug("Hello World!")).toBe("hello-world");
  });
});`,
};

export const urlShortenerScenario: AgentTaskScenario = {
  id: "url-shortener",
  name: "URL Shortener Service",
  domain: "Link shortening microservice",
  systemContext: buildSystemContext("URL Shortener", "TypeScript", "metrics, health check"),
  turns: [
    { id: "t01", label: "ShortLink model", userMessage: "Define ShortLink with slug, targetUrl, createdAt, clicks.", artifact: "link" },
    { id: "t02", label: "Slug encoding", userMessage: "Implement encodeSlug and randomSlug helpers.", artifact: "encoder" },
    { id: "t03", label: "Registry", userMessage: "Build LinkRegistry with register, resolve, incrementClicks.", artifact: "registry" },
    { id: "t04", label: "Duplicate link", userMessage: "Define ShortLink with slug, targetUrl, createdAt, clicks.", artifact: "link" },
    { id: "t05", label: "Paraphrase registry", userMessage: "Create a slug-to-link map with click tracking.", artifact: "registry" },
    { id: "t06", label: "Analytics", userMessage: "Map ShortLink to LinkStats for reporting.", artifact: "analytics" },
    { id: "t07", label: "Paraphrase encoder", userMessage: "Generate URL-safe slugs from custom text or random strings.", artifact: "encoder" },
    { id: "t08", label: "Service", userMessage: "UrlShortenerService with shorten, redirect, stats.", artifact: "service" },
    { id: "t09", label: "Duplicate registry", userMessage: "Build LinkRegistry with register, resolve, incrementClicks.", artifact: "registry" },
    { id: "t10", label: "Tests", userMessage: "Vitest for shorten/redirect and slug encoding.", artifact: "tests" },
  ],
  artifacts,
  minCacheHits: 4,
  validateArtifacts(artifacts) {
    const notes: string[] = [];
    if (!artifacts.service?.includes("UrlShortenerService")) notes.push("Missing UrlShortenerService");
    return { valid: notes.length === 0, notes };
  },
};
