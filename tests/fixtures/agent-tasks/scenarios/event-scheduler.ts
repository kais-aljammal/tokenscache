import { buildSystemContext, type AgentTaskScenario } from "../types.js";

const artifacts = {
  event: `export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  attendees: string[];
}

export function createEvent(title: string, start: Date, end: Date, attendees: string[] = []): CalendarEvent {
  if (end <= start) throw new Error("End must be after start");
  return { id: crypto.randomUUID(), title, start, end, attendees };
}`,
  recurrence: `export type RecurrenceFrequency = "daily" | "weekly" | "monthly";

export interface RecurrenceRule {
  frequency: RecurrenceFrequency;
  interval: number;
  until?: Date;
}

export function nextOccurrence(from: Date, rule: RecurrenceRule): Date {
  const next = new Date(from);
  if (rule.frequency === "daily") next.setDate(next.getDate() + rule.interval);
  else if (rule.frequency === "weekly") next.setDate(next.getDate() + 7 * rule.interval);
  else next.setMonth(next.getMonth() + rule.interval);
  return next;
}`,
  conflicts: `import type { CalendarEvent } from "./event.js";

export function hasConflict(a: CalendarEvent, b: CalendarEvent): boolean {
  return a.start < b.end && b.start < a.end;
}

export function findConflicts(events: CalendarEvent[], candidate: CalendarEvent): CalendarEvent[] {
  return events.filter((e) => e.id !== candidate.id && hasConflict(e, candidate));
}`,
  calendar: `import type { CalendarEvent } from "./event.js";
import { findConflicts } from "./conflicts.js";

export class Calendar {
  private events: CalendarEvent[] = [];

  schedule(event: CalendarEvent): void {
    const conflicts = findConflicts(this.events, event);
    if (conflicts.length) throw new Error(\`Conflicts with \${conflicts.map((c) => c.title).join(", ")}\`);
    this.events.push(event);
  }

  list(rangeStart: Date, rangeEnd: Date): CalendarEvent[] {
    return this.events.filter((e) => e.start < rangeEnd && e.end > rangeStart);
  }
}`,
  notifier: `import type { CalendarEvent } from "./event.js";

export interface Notifier {
  sendReminder(event: CalendarEvent, minutesBefore: number): Promise<void>;
}

export class ConsoleNotifier implements Notifier {
  async sendReminder(event: CalendarEvent, minutesBefore: number): Promise<void> {
    console.log(\`Reminder: \${event.title} in \${minutesBefore}m\`);
  }
}`,
  service: `import { createEvent, type CalendarEvent } from "./event.js";
import { Calendar } from "./calendar.js";
import { ConsoleNotifier } from "./notifier.js";
import type { RecurrenceRule } from "./recurrence.js";
import { nextOccurrence } from "./recurrence.js";

export class SchedulerService {
  private calendar = new Calendar();
  private notifier = new ConsoleNotifier();

  book(title: string, start: Date, end: Date, attendees?: string[]): CalendarEvent {
    const event = createEvent(title, start, end, attendees);
    this.calendar.schedule(event);
    return event;
  }

  expandRecurring(base: CalendarEvent, rule: RecurrenceRule, count: number): CalendarEvent[] {
    const out: CalendarEvent[] = [base];
    let cursor = base.start;
    for (let i = 1; i < count; i++) {
      cursor = nextOccurrence(cursor, rule);
      out.push(createEvent(base.title, cursor, new Date(cursor.getTime() + (base.end.getTime() - base.start.getTime())), base.attendees));
    }
    return out;
  }

  remind(event: CalendarEvent, minutesBefore: number): Promise<void> {
    return this.notifier.sendReminder(event, minutesBefore);
  }
}`,
  tests: `import { describe, it, expect } from "vitest";
import { createEvent } from "./event.js";
import { hasConflict } from "./conflicts.js";
import { nextOccurrence } from "./recurrence.js";

describe("Scheduler", () => {
  it("detects overlap", () => {
    const a = createEvent("A", new Date("2026-07-01T10:00"), new Date("2026-07-01T11:00"));
    const b = createEvent("B", new Date("2026-07-01T10:30"), new Date("2026-07-01T11:30"));
    expect(hasConflict(a, b)).toBe(true);
  });
  it("advances recurrence", () => {
    const next = nextOccurrence(new Date("2026-07-01"), { frequency: "daily", interval: 1 });
    expect(next.getDate()).toBe(2);
  });
});`,
};

export const eventSchedulerScenario: AgentTaskScenario = {
  id: "event-scheduler",
  name: "Event Scheduler / Calendar",
  domain: "Meeting scheduling backend",
  systemContext: buildSystemContext("Event Scheduler", "TypeScript", "timezone utils, email stub"),
  turns: [
    { id: "t01", label: "Event model", userMessage: "CalendarEvent with id, title, start, end, attendees.", artifact: "event" },
    { id: "t02", label: "Recurrence", userMessage: "RecurrenceRule and nextOccurrence helper.", artifact: "recurrence" },
    { id: "t03", label: "Conflict detection", userMessage: "hasConflict and findConflicts for overlapping events.", artifact: "conflicts" },
    { id: "t04", label: "Duplicate event", userMessage: "CalendarEvent with id, title, start, end, attendees.", artifact: "event" },
    { id: "t05", label: "Paraphrase conflicts", userMessage: "Detect schedule overlaps between calendar entries.", artifact: "conflicts" },
    { id: "t06", label: "Calendar store", userMessage: "Calendar class with schedule and list in date range.", artifact: "calendar" },
    { id: "t07", label: "Notifier", userMessage: "Notifier interface and ConsoleNotifier stub.", artifact: "notifier" },
    { id: "t08", label: "Scheduler service", userMessage: "SchedulerService for book, expandRecurring, remind.", artifact: "service" },
    { id: "t09", label: "Duplicate recurrence", userMessage: "RecurrenceRule and nextOccurrence helper.", artifact: "recurrence" },
    { id: "t10", label: "Tests", userMessage: "Vitest for conflict detection and recurrence.", artifact: "tests" },
  ],
  artifacts,
  minCacheHits: 3,
  validateArtifacts(artifacts) {
    const notes: string[] = [];
    if (!artifacts.service?.includes("SchedulerService")) notes.push("Missing SchedulerService");
    if (!artifacts.conflicts?.includes("hasConflict")) notes.push("Missing conflict detection");
    return { valid: notes.length === 0, notes };
  },
};
