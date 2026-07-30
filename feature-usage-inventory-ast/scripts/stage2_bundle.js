#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { buildStage2Records } = require("./stage_findings");
const { renderStage2BundleReport } = require("./render_stage2_report");

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function jsonl(values) {
  return values.map((value) => JSON.stringify(value)).join("\n") + (values.length ? "\n" : "");
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function writeFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}

function artifactRecord(root, relative, purpose, records = null) {
  const file = path.join(root, relative);
  return {
    path: relative.replace(/\\/g, "/"),
    purpose,
    bytes: fs.statSync(file).size,
    sha256: sha256File(file),
    records,
  };
}

function transitionFields(facts, findings) {
  const previous = facts.transition && facts.transition.fields || {};
  const confirmed = findings.filter((item) => item.status === "confirmed").length;
  return {
    target: previous.target || "stage 2 target",
    scope: previous.scope || "scope recorded in facts artifact",
    stage: "2",
    status: facts.status || "candidate",
    "confirmed evidence": confirmed ? `${confirmed} confirmed findings` : "none promoted automatically",
    "candidate evidence": `${findings.length} candidate findings with machine-readable evidence references`,
    "dictionary/graph/path state": `AST plan ${facts.runtime && facts.runtime.planId || "unknown"}; boundary candidates=${(facts.boundaries || []).length}; human-readable dictionary decoded in report`,
    "skipped/forbidden": previous["skipped/forbidden"] || "see report limitations and manifest",
    "open checks": previous["open checks"] || "source confirmation and later-stage scenario checks",
    "next stage": "3 — scenario and recipient expansion after explicit user continuation",
  };
}

function evidenceCategory(item) {
  const haystack = `${item.query || ""} ${item.check || ""} ${item.relation || ""}`.toLowerCase();
  if (/binary|json|serial|writer|reader|persist|write|read/.test(haystack)) return "persistence";
  if (/owner|field|setter|parameter|construct/.test(haystack)) return "ownership";
  return "recipients";
}

function renderEvidenceView(title, evidence) {
  const lines = [`# ${title}`, "", `Records: ${evidence.length}`, "", "| Kind | Status | Relation/check | Source | Concrete data |", "|---|---|---|---|---|"];
  for (const item of evidence) {
    const source = item.source || {};
    const anchor = `${source.file || ""}${source.line ? `:${source.line}` : ""}`;
    const relation = item.relation || item.check || item.query || "";
    const concrete = item.snippet || [item.owner, item.field, item.target].filter(Boolean).join(" → ");
    lines.push(`| ${item.kind} | ${item.status} | ${String(relation).replace(/\|/g, "\\|")} | ${String(anchor).replace(/\|/g, "\\|")} | ${String(concrete).replace(/\|/g, "\\|")} |`);
  }
  return `${lines.join("\n")}\n`;
}

function sourceArchive(facts) {
  const checks = facts.sourceEvidence && (facts.sourceEvidence.checks || facts.sourceEvidence) || [];
  return {
    checks: checks.map((check) => ({ id: check.id, status: check.status, spec: check.spec || null, filesScanned: check.filesScanned, totalMatches: check.totalMatches, returned: check.returned, fullMatches: (check.fullMatches || []).length, groupDigest: check.groupDigest })),
    observations: checks.flatMap((check) => (check.fullMatches || []).map((match) => ({ schemaVersion: "1.0.0", kind: "source-observation", status: "candidate", check: check.id, source: { file: match.file, line: match.line }, pattern: match.patternId, groupKey: match.groupKey, snippet: match.snippet }))),
  };
}

function buildStage2Bundle(facts, outputDirectory, options = {}) {
  if (!facts || Number(facts.stage) !== 2) throw new Error("Stage 2 facts are required");
  const output = path.resolve(outputDirectory);
  if (fs.existsSync(output)) throw new Error(`Bundle destination already exists: ${output}`);
  const parent = path.dirname(output);
  fs.mkdirSync(parent, { recursive: true });
  const temporary = path.join(parent, `.${path.basename(output)}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`);
  fs.mkdirSync(temporary);
  try {
    const records = buildStage2Records(facts);
    const source = sourceArchive(facts);
    const transition = { schemaVersion: "1.0.0", fields: transitionFields(facts, records.findings), valid: true };
    const coverage = {
      schemaVersion: "1.0.0",
      stage: 2,
      status: facts.quality && facts.quality.coverageGate && facts.quality.coverageGate.status || "unknown",
      gate: facts.quality && facts.quality.coverageGate || null,
      ast: {
        plan: facts.ast && facts.ast.plan || null,
        stats: facts.ast && facts.ast.stats || null,
        queries: (facts.ast && (facts.ast.results || facts.ast.queries) || []).map((item) => ({ id: item.id, groupDigest: item.groupDigest, coverage: item.coverage })),
      },
      source: (facts.sourceEvidence && (facts.sourceEvidence.checks || facts.sourceEvidence) || []).map((item) => ({ id: item.id, groupDigest: item.groupDigest, filesScanned: item.filesScanned, totalMatches: item.totalMatches, returned: item.returned, truncated: item.truncated })),
    };
    if (!coverage.gate || !coverage.gate.ok) throw new Error("Coverage gate must pass before publishing a bundle");
    if (facts.quality && facts.quality.equivalence && !facts.quality.equivalence.ok) throw new Error("Quality equivalence must pass before publishing a bundle");
    const validation = {
      schemaVersion: "1.0.0",
      status: coverage.gate && coverage.gate.ok ? "passed" : "partial",
      checks: {
        coverageGate: Boolean(coverage.gate && coverage.gate.ok),
        qualityEquivalence: facts.quality && facts.quality.equivalence ? Boolean(facts.quality.equivalence.ok) : "not-required",
        candidatePromotionDisabled: records.findings.every((item) => item.status !== "confirmed"),
        evidenceReferencesPresent: records.findings.every((item) => item.evidenceRefs.length > 0),
      },
    };

    writeFile(path.join(temporary, "facts.json"), json(facts));
    writeFile(path.join(temporary, "boundaries.json"), json({ schemaVersion: "1.0.0", stage: 2, candidates: facts.boundaries || [] }));
    writeFile(path.join(temporary, "findings.jsonl"), jsonl(records.findings));
    writeFile(path.join(temporary, "evidence.jsonl.gz"), zlib.gzipSync(Buffer.from(jsonl(records.evidence)), { level: 9, mtime: 0 }));
    writeFile(path.join(temporary, "checks.json"), json({ schemaVersion: "1.0.0", stage: 2, checks: source.checks }));
    writeFile(path.join(temporary, "source-observations.jsonl.gz"), zlib.gzipSync(Buffer.from(jsonl(source.observations)), { level: 9, mtime: 0 }));
    writeFile(path.join(temporary, "coverage.json"), json(coverage));
    writeFile(path.join(temporary, "transition.json"), json(transition));
    writeFile(path.join(temporary, "validation.json"), json(validation));

    const categories = { ownership: [], persistence: [], recipients: [] };
    for (const item of records.evidence) categories[evidenceCategory(item)].push(item);
    writeFile(path.join(temporary, "evidence-view", "ownership.md"), renderEvidenceView("Ownership evidence", categories.ownership));
    writeFile(path.join(temporary, "evidence-view", "persistence.md"), renderEvidenceView("Persistence evidence", categories.persistence));
    writeFile(path.join(temporary, "evidence-view", "recipients.md"), renderEvidenceView("Recipient evidence", categories.recipients));

    const artifacts = [
      artifactRecord(temporary, "facts.json", "Complete stage facts", 1),
      artifactRecord(temporary, "boundaries.json", "Producer-consumer boundary candidates", (facts.boundaries || []).length),
      artifactRecord(temporary, "findings.jsonl", "Aggregated machine-readable findings", records.findings.length),
      artifactRecord(temporary, "evidence.jsonl.gz", "Compressed evidence records", records.evidence.length),
      artifactRecord(temporary, "checks.json", "Executed source-check contracts", source.checks.length),
      artifactRecord(temporary, "source-observations.jsonl.gz", "Complete source observations independent of report limits", source.observations.length),
      artifactRecord(temporary, "coverage.json", "Coverage counters and digests", 1),
      artifactRecord(temporary, "transition.json", "Data for continuing the analysis", 1),
      artifactRecord(temporary, "validation.json", "Generation quality gates", 1),
      artifactRecord(temporary, "evidence-view/ownership.md", "Human-readable ownership evidence", categories.ownership.length),
      artifactRecord(temporary, "evidence-view/persistence.md", "Human-readable persistence evidence", categories.persistence.length),
      artifactRecord(temporary, "evidence-view/recipients.md", "Human-readable recipient evidence", categories.recipients.length),
    ];
    const report = renderStage2BundleReport({ facts, findings: records.findings, transition, artifacts, maxFindings: options.maxFindings || 60 });
    writeFile(path.join(temporary, "report.md"), report);
    artifacts.unshift(artifactRecord(temporary, "report.md", "Human-readable stage report", 1));

    const manifest = {
      schemaVersion: "1.0.0",
      stage: 2,
      status: facts.status,
      source: facts.runtime && facts.runtime.source || null,
      planId: facts.runtime && facts.runtime.planId || null,
      cache: facts.runtime && facts.runtime.cache || { enabled: false },
      counts: { findings: records.findings.length, evidence: records.evidence.length, sourceObservations: source.observations.length, boundaries: (facts.boundaries || []).length },
      artifacts,
    };
    writeFile(path.join(temporary, "manifest.json"), json(manifest));

    const { validateStageBundle } = require("./validate_stage_bundle");
    const checked = validateStageBundle(temporary);
    if (!checked.ok) throw new Error(`Bundle validation failed: ${checked.errors.join("; ")}`);
    fs.renameSync(temporary, output);
    const summary = {
      status: facts.status,
      stage: 2,
      report: path.join(output, "report.md"),
      manifest: path.join(output, "manifest.json"),
      findings: records.findings.length,
      evidence: records.evidence.length,
      coverage: coverage.status,
      validation: "passed",
    };
    summary.stdoutBytes = Buffer.byteLength(JSON.stringify(summary) + "\n");
    return summary;
  } catch (error) {
    if (fs.existsSync(temporary) && path.dirname(temporary) === parent && path.basename(temporary).startsWith(`.${path.basename(output)}.tmp-`)) fs.rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!["--input", "--output"].includes(arg)) throw new Error(`Unknown option: ${arg}`);
    if (index + 1 >= argv.length) throw new Error(`Missing value for ${arg}`);
    options[arg.slice(2)] = argv[++index];
  }
  if (!options.input || !options.output) throw new Error("Provide --input <facts.json> --output <new-directory>");
  return options;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const facts = JSON.parse(fs.readFileSync(path.resolve(options.input), "utf8"));
    process.stdout.write(`${JSON.stringify(buildStage2Bundle(facts, options.output))}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: "error", errors: [{ message: error.message }] })}\n`);
    process.exitCode = 2;
  }
}

if (require.main === module) main();
module.exports = { artifactRecord, buildStage2Bundle, evidenceCategory, sourceArchive, transitionFields };
