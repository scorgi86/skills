#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { validateAuthorOutput, validateFacts } = require("./analysis-cache");
const { resolveAuthorEvidence } = require("./prepare-analysis-input");

const DEFAULT_ENDPOINT = "https://polza.ai/api/v1/responses";
const DEFAULT_MODEL = "deepseek/deepseek-chat";

const FACTS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["schema_version", "title", "summary", "architecture", "items", "unknowns"],
  properties: {
    schema_version: { type: "integer", enum: [1] },
    title: { type: "string" },
    summary: {
      type: "object", additionalProperties: false, required: ["problem", "solution", "outcome"],
      properties: { problem: { type: "string" }, solution: { type: "string" }, outcome: { type: "string" } }
    },
    architecture: {
      type: "object", additionalProperties: false, required: ["before", "after"],
      properties: {
        before: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
        after: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } }
      }
    },
    items: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["id", "kind", "statement", "evidence_ids"],
        properties: {
          id: { type: "string" },
          kind: { type: "string", enum: ["change", "flow", "rule", "contract", "feature_flag", "risk", "test_added", "context"] },
          statement: { type: "string" },
          impact: { type: "string" },
          evidence_ids: { type: "array", minItems: 1, items: { type: "string", pattern: "^E[1-9][0-9]*$" } }
        }
      }
    },
    unknowns: { type: "array", items: { type: "string" } }
  }
};

const AUTHOR_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["schema_version", "facts", "draft"],
  properties: {
    schema_version: { type: "integer", enum: [1] },
    facts: FACTS_SCHEMA,
    draft: { type: "string", minLength: 1 }
  }
};

function parseArgs(argv) {
  const args = {
    input: null, output: null, usageOutput: null, endpoint: DEFAULT_ENDPOINT,
    model: DEFAULT_MODEL, maxOutputTokens: 6000, allowExternal: false, selfTest: false
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--input") args.input = argv[++i];
    else if (arg === "--output") args.output = argv[++i];
    else if (arg === "--usage-output") args.usageOutput = argv[++i];
    else if (arg === "--endpoint") args.endpoint = argv[++i];
    else if (arg === "--model") args.model = argv[++i];
    else if (arg === "--max-output-tokens") args.maxOutputTokens = Number(argv[++i]);
    else if (arg === "--allow-external") args.allowExternal = true;
    else if (arg === "--self-test") args.selfTest = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function extractOutputText(response) {
  if (typeof response.output_text === "string") return response.output_text;
  const texts = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") texts.push(content.text);
    }
  }
  if (!texts.length) throw new Error("Polza response does not contain output text.");
  return texts.join("\n");
}

function parseFacts(text) {
  const normalized = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const facts = JSON.parse(normalized);
  validateFacts(facts);
  return facts;
}

function validateCompactAuthorOutput(output) {
  if (!output || output.schema_version !== 1 || !output.facts || typeof output.draft !== "string" || !output.draft.trim() ||
      !Array.isArray(output.facts.items) || output.facts.items.some((item) => !Array.isArray(item.evidence_ids) || !item.evidence_ids.length)) {
    throw new Error("Compact author-output.json does not match schema version 1.");
  }
}

function parseAuthorOutput(text, analysisInput) {
  const normalized = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const output = JSON.parse(normalized);
  if (analysisInput) {
    resolveAuthorEvidence(output, analysisInput);
    validateAuthorOutput(output);
  } else if (output.facts && output.facts.items.every((item) => Array.isArray(item.evidence))) {
    validateAuthorOutput(output);
  } else {
    validateCompactAuthorOutput(output);
  }
  return output;
}

async function invoke(options, modelInput, analysisInput) {
  if (!options.allowExternal) throw new Error("External model call requires --allow-external.");
  const apiKey = process.env.POLZA_AI_API_KEY;
  if (!apiKey) throw new Error("POLZA_AI_API_KEY is not configured.");
  const system = [
    "Analyze a prepared Git evidence package and return reviewer-oriented PR facts and a complete PR draft in Russian.",
    "Use only supplied evidence. Never invent identifiers, values, behavior, motivation or executed checks.",
    "Every repository-derived fact must cite one or more exact evidence_ids from the package. Do not reproduce paths, lines, quotes or symbols.",
    "Record exact formulas, thresholds, flags, callback values, state transitions and compatibility branches.",
    "Architecture before and after must both be non-empty and describe behavior, ownership or execution flow.",
    "For production configuration objects, capture every threshold and threshold array in rule facts.",
    "Tests present in source are test_added, never check_run. Keep unknown intent in unknowns.",
    "The draft must let a new reviewer identify the problem, trigger, before/after execution flow, outcomes, exceptions, risks and verification without decoding implementation shorthand."
  ].join(" ");
  const body = {
    model: options.model,
    input: [
      { role: "system", content: [{ type: "input_text", text: system }] },
      { role: "user", content: [{ type: "input_text", text: modelInput }] }
    ],
    text: { format: { type: "json_schema", name: "pr_author_output", strict: true, schema: AUTHOR_OUTPUT_SCHEMA } },
    max_output_tokens: options.maxOutputTokens,
    store: false
  };
  const response = await fetch(options.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) {
    const message = data && data.error && data.error.message || `HTTP ${response.status}`;
    throw new Error(`Polza request failed: ${message}`);
  }
  const authorOutput = parseAuthorOutput(extractOutputText(data), analysisInput);
  return { author_output: authorOutput, facts: authorOutput.facts, usage: data.usage || null, response_id: data.id || null };
}

function runSelfTest() {
  const text = extractOutputText({ output: [{ content: [{ type: "output_text", text: JSON.stringify({
    schema_version: 1,
    facts: { schema_version: 1, title: "Fixture", summary: { problem: "p", solution: "s", outcome: "o" },
      architecture: { before: ["before"], after: ["after"] }, items: [], unknowns: [] },
    draft: "# Fixture"
  }) }] }] });
  const authorOutput = parseAuthorOutput(text);
  if (authorOutput.schema_version !== 1 || !Array.isArray(authorOutput.facts.items)) {
    throw new Error("Self-test failed: response parsing is invalid.");
  }
  if (FACTS_SCHEMA.properties.items.items.required.includes("impact")) {
    throw new Error("Self-test failed: semantic/deep impact is required again.");
  }
  if (!FACTS_SCHEMA.properties.items.items.required.includes("evidence_ids") ||
      FACTS_SCHEMA.properties.items.items.required.includes("evidence")) {
    throw new Error("Self-test failed: compact evidence IDs are not required.");
  }
  let blocked = false;
  try {
    parseAuthorOutput("not json");
  } catch (error) {
    blocked = true;
  }
  if (!blocked) throw new Error("Self-test failed: invalid model output was accepted.");
  process.stdout.write("Self-test passed.\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) return runSelfTest();
  if (!args.input || !args.output) throw new Error("Use --input <analysis-prompt.txt> --output <facts.json> --allow-external.");
  const modelInput = fs.readFileSync(path.resolve(args.input), "utf8");
  const result = await invoke(args, modelInput);
  fs.writeFileSync(path.resolve(args.output), `${JSON.stringify(result.author_output, null, 2)}\n`, "utf8");
  if (args.usageOutput) {
    fs.writeFileSync(path.resolve(args.usageOutput), `${JSON.stringify({
      schema_version: 1, model: args.model, response_id: result.response_id, usage: result.usage
    }, null, 2)}\n`, "utf8");
  }
  process.stdout.write(`${JSON.stringify({ output: path.resolve(args.output), model: args.model, usage: result.usage }, null, 2)}\n`);
}

module.exports = { AUTHOR_OUTPUT_SCHEMA, FACTS_SCHEMA, extractOutputText, invoke, parseAuthorOutput, parseFacts };

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
