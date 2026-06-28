import { buildSystemContext, type AgentTaskScenario } from "../types.js";

const artifacts = {
  model: `export interface TodoItem {
  id: string;
  title: string;
  completed: boolean;
  priority: "low" | "medium" | "high";
  createdAt: Date;
}

export function createTodo(title: string, priority: TodoItem["priority"] = "medium"): TodoItem {
  return { id: crypto.randomUUID(), title, completed: false, priority, createdAt: new Date() };
}`,
  store: `import type { TodoItem } from "./model.js";

export class TodoStore {
  private items = new Map<string, TodoItem>();

  add(item: TodoItem): void { this.items.set(item.id, item); }
  get(id: string): TodoItem | undefined { return this.items.get(id); }
  list(): TodoItem[] { return [...this.items.values()]; }
  remove(id: string): boolean { return this.items.delete(id); }
}`,
  filter: `import type { TodoItem } from "./model.js";

export function filterTodos(items: TodoItem[], opts: { completed?: boolean; priority?: TodoItem["priority"] }): TodoItem[] {
  return items.filter((t) => {
    if (opts.completed !== undefined && t.completed !== opts.completed) return false;
    if (opts.priority && t.priority !== opts.priority) return false;
    return true;
  });
}`,
  validator: `export function validateTitle(title: string): void {
  const trimmed = title.trim();
  if (trimmed.length < 1 || trimmed.length > 200) throw new Error("Title must be 1-200 chars");
}`,
  service: `import { createTodo, type TodoItem } from "./model.js";
import { TodoStore } from "./store.js";
import { filterTodos } from "./filter.js";
import { validateTitle } from "./validator.js";

export class TodoService {
  private store = new TodoStore();

  create(title: string, priority?: TodoItem["priority"]): TodoItem {
    validateTitle(title);
    const item = createTodo(title, priority);
    this.store.add(item);
    return item;
  }

  complete(id: string): TodoItem {
    const item = this.store.get(id);
    if (!item) throw new Error("Todo not found");
    item.completed = true;
    return item;
  }

  listOpen(): TodoItem[] {
    return filterTodos(this.store.list(), { completed: false });
  }
}`,
  tests: `import { describe, it, expect } from "vitest";
import { TodoService } from "./service.js";
import { filterTodos } from "./filter.js";
import { createTodo } from "./model.js";

describe("Todo API", () => {
  it("creates and completes todos", () => {
    const svc = new TodoService();
    const t = svc.create("Ship release");
    expect(t.completed).toBe(false);
    expect(svc.complete(t.id).completed).toBe(true);
  });
  it("filters by priority", () => {
    const items = [createTodo("a", "high"), createTodo("b", "low")];
    expect(filterTodos(items, { priority: "high" })).toHaveLength(1);
  });
});`,
};

export const todoApiScenario: AgentTaskScenario = {
  id: "todo-api",
  name: "Todo List REST API",
  domain: "Task management backend",
  systemContext: buildSystemContext("Todo API", "TypeScript + Express", "logging, config"),
  turns: [
    { id: "t01", label: "Todo model", userMessage: "Define TodoItem with id, title, completed, priority, createdAt.", artifact: "model" },
    { id: "t02", label: "In-memory store", userMessage: "Add TodoStore with add, get, list, remove.", artifact: "store" },
    { id: "t03", label: "Filtering", userMessage: "Implement filterTodos by completed and priority.", artifact: "filter" },
    { id: "t04", label: "Duplicate model", userMessage: "Define TodoItem with id, title, completed, priority, createdAt.", artifact: "model" },
    { id: "t05", label: "Paraphrase store", userMessage: "Build an in-memory todo repository supporting CRUD.", artifact: "store" },
    { id: "t06", label: "Validation", userMessage: "Validate todo titles are 1-200 characters.", artifact: "validator" },
    { id: "t07", label: "Paraphrase filter", userMessage: "Filter todo lists by completion status and priority level.", artifact: "filter" },
    { id: "t08", label: "Service layer", userMessage: "Create TodoService orchestrating store, filter, and validation.", artifact: "service" },
    { id: "t09", label: "Duplicate filter", userMessage: "Implement filterTodos by completed and priority.", artifact: "filter" },
    { id: "t10", label: "Tests", userMessage: "Write vitest tests for create, complete, and filter.", artifact: "tests" },
  ],
  artifacts,
  minCacheHits: 4,
  validateArtifacts(artifacts) {
    const notes: string[] = [];
    if (!artifacts.service?.includes("TodoService")) notes.push("Missing TodoService");
    if (!artifacts.tests?.includes("describe")) notes.push("Missing tests");
    return { valid: notes.length === 0, notes };
  },
};
