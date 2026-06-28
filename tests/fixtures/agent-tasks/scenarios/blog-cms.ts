import { buildSystemContext, type AgentTaskScenario } from "../types.js";

const artifacts = {
  post: `export interface BlogPost {
  id: string;
  title: string;
  slug: string;
  body: string;
  authorId: string;
  publishedAt: Date | null;
}

export function draftPost(title: string, body: string, authorId: string): BlogPost {
  return { id: crypto.randomUUID(), title, slug: "", body, authorId, publishedAt: null };
}`,
  slug: `export function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}`,
  repository: `import type { BlogPost } from "./post.js";

export class PostRepository {
  private posts = new Map<string, BlogPost>();

  save(post: BlogPost): void { this.posts.set(post.id, post); }
  findBySlug(slug: string): BlogPost | undefined {
    return [...this.posts.values()].find((p) => p.slug === slug);
  }
  listPublished(): BlogPost[] {
    return [...this.posts.values()].filter((p) => p.publishedAt !== null);
  }
}`,
  renderer: `export function renderExcerpt(body: string, maxLen = 160): string {
  const plain = body.replace(/[#*_\\[\]()]/g, "").trim();
  return plain.length <= maxLen ? plain : plain.slice(0, maxLen - 3) + "...";
}`,
  publisher: `import type { BlogPost } from "./post.js";
import { slugify } from "./slug.js";

export function publishPost(post: BlogPost): BlogPost {
  if (!post.title.trim()) throw new Error("Title required");
  return { ...post, slug: slugify(post.title), publishedAt: new Date() };
}`,
  service: `import { draftPost, type BlogPost } from "./post.js";
import { PostRepository } from "./repository.js";
import { renderExcerpt } from "./renderer.js";
import { publishPost } from "./publisher.js";

export class BlogService {
  private repo = new PostRepository();

  createDraft(title: string, body: string, authorId: string): BlogPost {
    const post = draftPost(title, body, authorId);
    this.repo.save(post);
    return post;
  }

  publish(id: string): BlogPost {
    const post = [...this.repo.listPublished(), ...this.repo.listPublished()].find((p) => p.id === id);
    const draft = this.repo.findBySlug("") ?? draftPost("", "", "");
    const published = publishPost(draft.id === id ? draft : { ...draft, id });
    this.repo.save(published);
    return published;
  }

  excerpt(body: string): string { return renderExcerpt(body); }
}`,
  tests: `import { describe, it, expect } from "vitest";
import { slugify } from "./slug.js";
import { renderExcerpt } from "./renderer.js";
import { publishPost } from "./publisher.js";
import { draftPost } from "./post.js";

describe("Blog CMS", () => {
  it("slugifies titles", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });
  it("renders excerpt", () => {
    expect(renderExcerpt("a".repeat(200)).length).toBeLessThanOrEqual(160);
  });
  it("publishes with slug", () => {
    const p = publishPost(draftPost("My Post", "body", "auth-1"));
    expect(p.slug).toBe("my-post");
    expect(p.publishedAt).toBeInstanceOf(Date);
  });
});`,
};

export const blogCmsScenario: AgentTaskScenario = {
  id: "blog-cms",
  name: "Blog CMS Backend",
  domain: "Content management for blog posts",
  systemContext: buildSystemContext("Blog CMS", "TypeScript", "auth, markdown"),
  turns: [
    { id: "t01", label: "Post model", userMessage: "Define BlogPost with id, title, slug, body, authorId, publishedAt.", artifact: "post" },
    { id: "t02", label: "Slug helper", userMessage: "Implement slugify from post title.", artifact: "slug" },
    { id: "t03", label: "Repository", userMessage: "PostRepository with save, findBySlug, listPublished.", artifact: "repository" },
    { id: "t04", label: "Duplicate post", userMessage: "Define BlogPost with id, title, slug, body, authorId, publishedAt.", artifact: "post" },
    { id: "t05", label: "Paraphrase repo", userMessage: "In-memory post store with slug lookup and published filter.", artifact: "repository" },
    { id: "t06", label: "Excerpt renderer", userMessage: "renderExcerpt strips markdown and truncates to 160 chars.", artifact: "renderer" },
    { id: "t07", label: "Publish flow", userMessage: "publishPost assigns slug and publishedAt timestamp.", artifact: "publisher" },
    { id: "t08", label: "Blog service", userMessage: "BlogService for drafts, publish, and excerpts.", artifact: "service" },
    { id: "t09", label: "Duplicate slug", userMessage: "Implement slugify from post title.", artifact: "slug" },
    { id: "t10", label: "Tests", userMessage: "Vitest for slugify, excerpt, and publish.", artifact: "tests" },
  ],
  artifacts,
  minCacheHits: 3,
  validateArtifacts(artifacts) {
    const notes: string[] = [];
    if (!artifacts.service?.includes("BlogService")) notes.push("Missing BlogService");
    if (!artifacts.slug?.includes("slugify")) notes.push("Missing slugify");
    return { valid: notes.length === 0, notes };
  },
};
