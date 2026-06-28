import { buildSystemContext, type AgentTaskScenario } from "../types.js";

const artifacts = {
  schema: `export interface CsvColumn {
  name: string;
  type: "string" | "number" | "boolean" | "date";
  required?: boolean;
}

export interface CsvSchema {
  name: string;
  columns: CsvColumn[];
}`,
  parser: `export function parseCsvLine(line: string, delimiter = ","): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === delimiter && !inQuotes) { result.push(current.trim()); current = ""; continue; }
    current += ch;
  }
  result.push(current.trim());
  return result;
}`,
  validator: `import type { CsvSchema } from "./schema.js";

export function validateRow(values: string[], schema: CsvSchema): string[] {
  const errors: string[] = [];
  schema.columns.forEach((col, i) => {
    const val = values[i] ?? "";
    if (col.required && !val) errors.push(\`Missing \${col.name}\`);
    if (col.type === "number" && val && Number.isNaN(Number(val))) errors.push(\`\${col.name} not numeric\`);
  });
  return errors;
}`,
  transformer: `import type { CsvSchema } from "./schema.js";

export function rowToRecord(values: string[], schema: CsvSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  schema.columns.forEach((col, i) => {
    const raw = values[i] ?? "";
    if (col.type === "number") out[col.name] = Number(raw);
    else if (col.type === "boolean") out[col.name] = raw === "true";
    else out[col.name] = raw;
  });
  return out;
}`,
  pipeline: `import type { CsvSchema } from "./schema.js";
import { parseCsvLine } from "./parser.js";
import { validateRow } from "./validator.js";
import { rowToRecord } from "./transformer.js";

export interface ParseResult {
  records: Record<string, unknown>[];
  errors: Array<{ line: number; messages: string[] }>;
}

export function parseCsv(text: string, schema: CsvSchema): ParseResult {
  const lines = text.split("\\n").filter((l) => l.trim());
  const records: Record<string, unknown>[] = [];
  const errors: ParseResult["errors"] = [];
  lines.slice(1).forEach((line, idx) => {
    const values = parseCsvLine(line);
    const rowErrors = validateRow(values, schema);
    if (rowErrors.length) errors.push({ line: idx + 2, messages: rowErrors });
    else records.push(rowToRecord(values, schema));
  });
  return { records, errors };
}`,
  tests: `import { describe, it, expect } from "vitest";
import { parseCsvLine } from "./parser.js";
import { parseCsv } from "./pipeline.js";

const schema = {
  name: "users",
  columns: [
    { name: "id", type: "number" as const, required: true },
    { name: "email", type: "string" as const, required: true },
  ],
};

describe("CSV parser", () => {
  it("parses quoted fields", () => {
    expect(parseCsvLine('a,"b,c",d')).toEqual(["a", "b,c", "d"]);
  });
  it("runs full pipeline", () => {
    const csv = "id,email\\n1,alice@test.com\\n2,bob@test.com";
    const result = parseCsv(csv, schema);
    expect(result.records).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });
});`,
};

export const csvParserScenario: AgentTaskScenario = {
  id: "csv-parser",
  name: "CSV Ingestion Pipeline",
  domain: "ETL data import",
  systemContext: buildSystemContext("CSV Parser", "TypeScript batch jobs", "S3 stub, logging"),
  turns: [
    { id: "t01", label: "Schema types", userMessage: "Define CsvColumn and CsvSchema types.", artifact: "schema" },
    { id: "t02", label: "Line parser", userMessage: "parseCsvLine handles quoted delimiters.", artifact: "parser" },
    { id: "t03", label: "Row validator", userMessage: "validateRow checks required fields and types.", artifact: "validator" },
    { id: "t04", label: "Duplicate schema", userMessage: "Define CsvColumn and CsvSchema types.", artifact: "schema" },
    { id: "t05", label: "Paraphrase parser", userMessage: "Split CSV lines respecting double-quote escaping.", artifact: "parser" },
    { id: "t06", label: "Transformer", userMessage: "rowToRecord maps string cells to typed record.", artifact: "transformer" },
    { id: "t07", label: "Paraphrase validator", userMessage: "Collect validation errors per row against schema.", artifact: "validator" },
    { id: "t08", label: "Pipeline", userMessage: "parseCsv orchestrates parse, validate, transform.", artifact: "pipeline" },
    { id: "t09", label: "Duplicate parser", userMessage: "parseCsvLine handles quoted delimiters.", artifact: "parser" },
    { id: "t10", label: "Tests", userMessage: "Vitest for line parse and full pipeline.", artifact: "tests" },
  ],
  artifacts,
  minCacheHits: 4,
  validateArtifacts(artifacts) {
    const notes: string[] = [];
    if (!artifacts.pipeline?.includes("parseCsv")) notes.push("Missing parseCsv pipeline");
    return { valid: notes.length === 0, notes };
  },
};
