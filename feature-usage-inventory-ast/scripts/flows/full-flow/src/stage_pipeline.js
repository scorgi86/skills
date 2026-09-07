"use strict";

const crypto = require("node:crypto");

const { normalizeRepositoryScope } = require("../../../shared/dto/src/repository_scope.js");

const path = require("node:path");

const { PLANNING_COLLECTIONS: PLANNING_INPUT_COLLECTIONS, mergeRows } = require("../../../shared/dto/src/planning_contract.js");

const fs = require("node:fs");

const { writeStageArtifact } = require("../../../shared/artifacts/src/stage_artifact_v4.js");
const { closureErrors, resolveChecks } = require("../../../shared/artifacts/src/canonical/checks.js");
const { buildLineageFromPrevious, validateCheckHistory } = require("../../../shared/artifacts/src/canonical/lineage.js");
const { runTransaction } = require("./transaction.js");
const { prepareFacts } = require("../../../shared/artifacts/src/canonical/facts.js");

function slug(value) {
  return String(value || "inventory").normalize("NFKD").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "inventory";
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function scopeDigest(scope) { return crypto.createHash("sha256").update(JSON.stringify(stable(scope))).digest("hex").slice(0, 12); }

function defaultOutputRoot(request, cwd = process.cwd()) {
  const scope = normalizeRepositoryScope(request.repositoryScope, { requireExisting: request.requireExistingRoots !== false });
  return path.join(path.resolve(cwd), ".codex", "inventory-artifacts", `${slug(request.target)}-${scopeDigest({ scope, target: String(request.target || "inventory").normalize("NFC") })}`);
}

function runnerFor(stage) {
  if (stage === 0) return require("../../../steps/step-0/src/runner.js").runStage0;
  if (stage === 1) return require("../../../steps/step-1/src/runner.js").runStage1;
  if (stage === 2) return require("../../../steps/step-2/src/runner.js").runStage2;
  if (stage === 3) return require("../../../steps/step-3/src/runner.js").runStage3;
  if (stage === 4) return require("../../../steps/step-4/src/runner.js").runStage4;
  if (stage === 5) return require("../../../steps/step-5/src/runner.js").runStage5;
  if (stage === 6) return require("../../../steps/step-6/src/runner.js").runStage6;
  if (stage === 7) return (request) => require("../../../steps/step-7/src/runner.js").buildStage7(request, { artifactBase: request.artifactBase || process.cwd() });
  throw new Error("stage_pipeline supports stages 0..7; Stage 8 uses its digest-bound renderer");
}

function transactionStatus(facts) {
  return closureErrors(facts).length ? "partial" : "closed";
}

function carryPlanningFacts(request, produced) {
  const result = { ...produced };
  for (const name of PLANNING_INPUT_COLLECTIONS) {
    const raw = [...(Array.isArray(request[name]) ? request[name] : []), ...(Array.isArray(produced[name]) ? produced[name] : [])];
    const rows = name === "limitations" ? require("../../../shared/artifacts/src/limitations.js").normalizeLimitations(raw) : raw;
    if (rows.length) result[name] = mergeRows(rows);
  }
  return result;
}

function runState(args) { return require("../../../state/src/stage_state.js").main(args); }

function runStagePipeline(options = {}) {
  const request = options.request;
  if (!request || !Number.isInteger(Number(request.stage))) throw new Error("Pipeline request requires stage 0..7");
  const stage = Number(request.stage);
  if (stage < 0 || stage > 7) throw new Error("Pipeline request requires stage 0..7");
  const execution = stage === 0 ? require("../../../steps/step-0/src/execution_scope.js").resolveExecutionScope(request) : null;
  if (!execution) normalizeRepositoryScope(request.repositoryScope, { requireExisting: request.requireExistingRoots !== false });
  const initialProfile = stage === 0 ? require("./coverage_profile.js").coverageProfile(request) : undefined;
  const outputRoot = options.outputRoot || defaultOutputRoot(request, options.cwd);
  require("./output_readiness.js").assertOutputReady(outputRoot);
  return runTransaction({ outputRoot, stage, request, stateFile: options.stateFile,
    validateCandidate({ canonical }) {
      if (initialProfile && digestLineage(canonical.summary?.coverageProfile) !== digestLineage(initialProfile)) {
        throw new Error("Stage 0 coverageProfile is missing or incompatible; preserve this transaction and reissue the run");
      }
      if (execution && digestLineage(canonical.summary?.executionScope) !== digestLineage(execution.descriptor)) {
        throw new Error("Stage 0 execution scope descriptor is missing or incompatible; preserve the pending transaction and state, and reissue the stage in a separately coordinated run. Do not reset or rebind advanced state automatically");
      }
    },
    prepare(outputDir, previous, archived) {
      if (previous && (previous.canonical.stage !== stage || !previous.canonical.summary.repositoryScope
          || digestLineage(previous.canonical.summary.repositoryScope) !== digestLineage(request.repositoryScope))) {
        throw new Error("Partial artifact has missing or different scope/stage; reissue the stage and dependent artifacts without modifying the original");
      }
      let active = null;
      if (options.stateFile) {
        runState(["assert", "--state", options.stateFile, "--stage", String(stage)]);
        active = JSON.parse(fs.readFileSync(path.resolve(options.stateFile), "utf8"));
      }
      const transitionArtifact = request.transitionArtifact ? require("../../../shared/artifacts/src/artifact_location.js").canonicalResultPath(path.resolve(request.artifactBase || process.cwd(), request.transitionArtifact)) : active?.canonicalArtifact;
      if (active?.canonicalArtifact && transitionArtifact && transitionArtifact !== active.canonicalArtifact) throw new Error("Transition artifact is not the active state revision");
      const lineage = buildLineageFromPrevious(active?.canonicalArtifact || request.transitionArtifact, stage, request.repositoryScope, request.artifactBase);
      const profile = stage === 0 ? initialProfile : require("./coverage_profile.js").coverageProfile(request, lineage);
      const runnerRequest = { ...request, ...(transitionArtifact ? { transitionArtifact } : {}), ...(stage === 7 ? { expectedArtifact: active?.canonicalArtifact } : {}) };
      const runnerResult = (options.runner || runnerFor(stage))(runnerRequest, options.dependencies || {});
      let facts = runnerResult;
      if (stage !== 7) {
        const produced = prepareFacts({ ...carryPlanningFacts(request, runnerResult), repositoryScope: request.repositoryScope });
        const { checkContext, aliasMap } = require("./check_context.js");
        const context = checkContext(previous, lineage);
        for (const [kind, collection] of [["gap", "gaps"], ["limitation", "limitations"]]) {
          const inherited = context.corrections.filter(row => row.kind === kind);
          if (inherited.length) produced[collection] = mergeRows([...inherited, ...(produced[collection] || [])]);
        }
        const evidence = new Map(context.evidence.map(row => [row.id, row]));
        for (const row of produced.canonicalEvidence || []) evidence.set(row.id, row);
        const receipts = require("../../../shared/evidence/src/canonicalization/canonicalize.js").remapEvidenceReferences(request.checkResolutions || produced.checkResolutions || [], aliasMap([...evidence.values()]));
        const resolved = resolveChecks(context.canonical, { ...produced, ...(request.checkRequirements === undefined ? {} : { checkRequirements: request.checkRequirements }), openChecks: [...new Set([...(request.openChecks || []), ...(produced.openChecks || [])])] }, receipts, [...evidence.values()], request.repositoryScope);
        facts = { ...resolved, repositoryScope: request.repositoryScope, exclusions: execution ? execution.exclusions : request.exclusions || [],
          canonicalEvidence: [...evidence.values()], status: transactionStatus(resolved), runnerStatus: produced.status || "unknown",
          summary: { ...resolved.summary, ...(produced.evidenceDiagnostics?.length ? { evidenceDiagnostics: produced.evidenceDiagnostics } : {}), ...(profile === undefined ? {} : { coverageProfile: profile }), ...(execution ? { executionScope: execution.descriptor } : {}), runnerStatus: produced.status || "unknown", lineage, checkHistory: previous ? [...(previous.canonical.summary.checkHistory || []), { artifact: path.join(archived, "canonical/stage-result.json"), outputDigest: previous.canonical.outputDigest }] : [] } };
      } else {
        // Model mutation here would invalidate the Stage7 digest.
        if (digestLineage(facts.provenance?.lineage) !== digestLineage(lineage)) throw new Error("Stage 7 model must preserve the validated active lineage");
      }
      writeStageArtifact({ outputDir, facts, input: request, usage: options.usage, retainRaw: options.retainRaw === true, metrics: options.metrics || {} });
    },
    advance({ resultFile, canonical }) {
      validateCheckHistory(canonical);
      const directory = path.dirname(resultFile);
      const manifest = path.join(directory, "manifest.json");
      if (canonical.status !== "closed") return { status: "partial", stage, artifact: resultFile, manifest, stateChanged: false, runnerStatus: canonical.summary.runnerStatus || "partial" };
      const state = options.stateFile ? runState(["advance", "--state", options.stateFile, "--stage", String(stage), "--artifact", resultFile]) : null;
      return { status: "closed", stage, artifact: resultFile, evidence: path.join(directory, "evidence.json"), manifest, rawRetained: JSON.parse(fs.readFileSync(manifest, "utf8")).retainRaw, stateChanged: Boolean(state?.stateChanged), nextStage: stage + 1 };
    }
  });
}
function digestLineage(value) { return require("../../../shared/artifacts/src/canonical/validation.js").digest(value || []); }

function parseArgs(argv) {
  const options = { retainRaw: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--retain-raw") options.retainRaw = true;
    else if (["--request", "--state", "--output-root", "--usage"].includes(arg)) options[arg.slice(2)] = argv[++index];
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!options.request) throw new Error("Provide --request <request.json>");
  return options;
}

module.exports = { carryPlanningFacts, defaultOutputRoot, parseArgs, runStagePipeline, runnerFor, scopeDigest, slug, transactionStatus };
