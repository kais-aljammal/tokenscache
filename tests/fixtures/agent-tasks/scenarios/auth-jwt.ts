import { buildSystemContext, type AgentTaskScenario } from "../types.js";

const artifacts = {
  user: `export interface User {
  id: string;
  email: string;
  passwordHash: string;
  roles: string[];
}

export function createUser(email: string, passwordHash: string, roles: string[] = ["user"]): User {
  return { id: crypto.randomUUID(), email: email.toLowerCase(), passwordHash, roles };
}`,
  hash: `import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = createHash("sha256").update(salt + password).digest("hex");
  return \`\${salt}:\${hash}\`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, expected] = stored.split(":");
  const hash = createHash("sha256").update(salt + password).digest("hex");
  return timingSafeEqual(Buffer.from(hash), Buffer.from(expected));
}`,
  token: `import { createHmac } from "node:crypto";

export interface JwtPayload {
  sub: string;
  email: string;
  roles: string[];
  exp: number;
}

export function signToken(payload: JwtPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return \`\${body}.\${sig}\`;
}

export function verifyToken(token: string, secret: string): JwtPayload | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  if (sig !== expected) return null;
  return JSON.parse(Buffer.from(body, "base64url").toString()) as JwtPayload;
}`,
  refresh: `export interface RefreshSession {
  userId: string;
  token: string;
  expiresAt: Date;
}

export class RefreshTokenStore {
  private sessions = new Map<string, RefreshSession>();

  issue(userId: string, ttlMs: number): RefreshSession {
    const session: RefreshSession = {
      userId,
      token: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + ttlMs),
    };
    this.sessions.set(session.token, session);
    return session;
  }

  consume(token: string): RefreshSession | null {
    const session = this.sessions.get(token);
    if (!session || session.expiresAt < new Date()) return null;
    this.sessions.delete(token);
    return session;
  }
}`,
  middleware: `import { verifyToken, type JwtPayload } from "./token.js";

export function requireAuth(authHeader: string | undefined, secret: string): JwtPayload {
  if (!authHeader?.startsWith("Bearer ")) throw new Error("Missing token");
  const payload = verifyToken(authHeader.slice(7), secret);
  if (!payload || payload.exp * 1000 < Date.now()) throw new Error("Invalid token");
  return payload;
}`,
  service: `import { createUser, type User } from "./user.js";
import { hashPassword, verifyPassword } from "./hash.js";
import { signToken, verifyToken } from "./token.js";
import { RefreshTokenStore } from "./refresh.js";
import { requireAuth } from "./middleware.js";

export class AuthService {
  private users = new Map<string, User>();
  private refresh = new RefreshTokenStore();

  register(email: string, password: string): User {
    const user = createUser(email, hashPassword(password));
    this.users.set(user.email, user);
    return user;
  }

  login(email: string, password: string, secret: string): { accessToken: string; refreshToken: string } {
    const user = this.users.get(email.toLowerCase());
    if (!user || !verifyPassword(password, user.passwordHash)) throw new Error("Invalid credentials");
    const accessToken = signToken({ sub: user.id, email: user.email, roles: user.roles, exp: Math.floor(Date.now() / 1000) + 3600 }, secret);
    const session = this.refresh.issue(user.id, 7 * 86400_000);
    return { accessToken, refreshToken: session.token };
  }

  authenticate(header: string | undefined, secret: string) {
    return requireAuth(header, secret);
  }
}`,
  tests: `import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./hash.js";
import { signToken, verifyToken } from "./token.js";

describe("Auth JWT", () => {
  it("hashes and verifies passwords", () => {
    const stored = hashPassword("secret123");
    expect(verifyPassword("secret123", stored)).toBe(true);
    expect(verifyPassword("wrong", stored)).toBe(false);
  });
  it("signs and verifies tokens", () => {
    const payload = { sub: "u1", email: "a@b.com", roles: ["user"], exp: Math.floor(Date.now() / 1000) + 60 };
    const token = signToken(payload, "test-secret");
    expect(verifyToken(token, "test-secret")?.sub).toBe("u1");
  });
});`,
};

export const authJwtScenario: AgentTaskScenario = {
  id: "auth-jwt",
  name: "JWT Auth Service",
  domain: "User authentication microservice",
  systemContext: buildSystemContext("Auth Service", "TypeScript + Node crypto", "session store, audit"),
  turns: [
    { id: "t01", label: "User model", userMessage: "User with id, email, passwordHash, roles.", artifact: "user" },
    { id: "t02", label: "Password hash", userMessage: "hashPassword and verifyPassword with salt.", artifact: "hash" },
    { id: "t03", label: "JWT helpers", userMessage: "signToken and verifyToken with HMAC-SHA256.", artifact: "token" },
    { id: "t04", label: "Duplicate user", userMessage: "User with id, email, passwordHash, roles.", artifact: "user" },
    { id: "t05", label: "Paraphrase hash", userMessage: "Secure password storage with salted SHA-256.", artifact: "hash" },
    { id: "t06", label: "Refresh tokens", userMessage: "RefreshTokenStore with issue and consume.", artifact: "refresh" },
    { id: "t07", label: "Auth middleware", userMessage: "requireAuth parses Bearer token and validates expiry.", artifact: "middleware" },
    { id: "t08", label: "Auth service", userMessage: "AuthService with register, login, authenticate.", artifact: "service" },
    { id: "t09", label: "Duplicate token", userMessage: "signToken and verifyToken with HMAC-SHA256.", artifact: "token" },
    { id: "t10", label: "Tests", userMessage: "Vitest for password hash and JWT round-trip.", artifact: "tests" },
  ],
  artifacts,
  minCacheHits: 3,
  validateArtifacts(artifacts) {
    const notes: string[] = [];
    if (!artifacts.service?.includes("AuthService")) notes.push("Missing AuthService");
    if (!artifacts.hash?.includes("verifyPassword")) notes.push("Missing verifyPassword");
    return { valid: notes.length === 0, notes };
  },
};
