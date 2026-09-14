"use strict";

const crypto = require("node:crypto");

const { normalizeRepositoryScope } = require("../../../shared/dto/src/repository_scope.js");

const path = require("node:path");

const { mergePlanningRows, mergeRows } = require("../../../shared/dto/src/planning_contract.js");
const { carryPlanningFacts, assertPlanningOutput } = require("./planning_output.js");

const fs = require("node:fs");

const { writeStageArtifact } = require("../../../shared/artifacts/src/stage_artifact_v4.js");
const { closureErrors, resolveChecks } = require("../../../shared/artifacts/src/canonical/checks.js");
const { validateCheckHistory } = require("../../../shared/artifacts/src/canonical/lineage.js");
const { canonicalFacts, prepareFacts } = require("../../../shared/artifacts/src/canonical/facts.js");
const { InventorySession } = require("../../../state/src/session/inventory_session.js");
const { SourceSnapshotStore } = require("../../../shared/evidence/src/source_snapshot.js");
const { keyOf } = require("../../../shared/evidence/src/canonicalization/candidate_identity.js");

function slug(value) {
  return String(value || "inventory").normalize("NFKD").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "inventory";
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function scopeDigest(scope) { return crypto.createHash("sha256").update(JSON.stringify(stable(scope))).digest("hex").slice(0, 12); }

function runtimeAstCachePath(outputRoot, repositoryScope) {
  return path.join(path.dirname(path.resolve(outputRoot)), ".runtime-cache", "ast", scopeDigest(normalizeRepositoryScope(repositoryScope, { requireExisting: false })));
}

function withRuntimeAstCache(request, outputRoot) {
  if (![1, 2].includes(Number(request?.stage)) || request.ast?.cache) return { ...request, ...(request.ast ? { ast: { ...request.ast } } : {}) };
  return { ...request, ast: { ...(request.ast || {}), cache: runtimeAstCachePath(outputRoot, request.repositoryScope) } };
}

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
  if (stage === 7) return (request, dependencies = {}, context = null) => require("../../../steps/step-7/src/runner.js").buildStage7(request, { artifactBase: request.artifactBase || process.cwd(), ...dependencies }, context);
  throw new Error("stage_pipeline supports stages 0..7; Stage 8 uses its digest-bound renderer");
}

function transactionStatus(facts) {
  return closureErrors(facts).length ? "partial" : "closed";
}

async function runStagePipeline(options = {}) {
  const request = options.request;
  if (!request || !Number.isInteger(Number(request.stage))) throw new Error("Pipeline request requires stage 0..7");
  const stage = Number(request.stage);
  if (stage < 0 || stage > 7) throw new Error("Pipeline request requires stage 0..7");
  if (stage === 0 && !options.runner && (!Array.isArray(request.seeds?.direct) || !request.seeds.direct.length || request.seeds.direct.some(seed => typeof seed !== "string" || !seed.trim()))) throw new Error("Stage 0 requires non-empty string seeds.direct");
  const execution = stage === 0 ? require("../../../steps/step-0/src/execution_scope.js").resolveExecutionScope(request) : null;
  if (!execution) normalizeRepositoryScope(request.repositoryScope, { requireExisting: request.requireExistingRoots !== false });
  const initialProfile = stage === 0 ? require("./coverage_profile.js").coverageProfile(request) : undefined;
  const outputRoot = options.outputRoot || defaultOutputRoot(request, options.cwd);
  require("./output_readiness.js").assertOutputReady(outputRoot);
  const session = InventorySession.open(options.stateFile ? { stateFile: options.stateFile } : {});
  return session.beginStage({ outputRoot, stage, request, stateFile: options.stateFile,
    validateCandidate({ canonical }) {
      if (initialProfile && digestLineage(canonical.summary?.coverageProfile) !== digestLineage(initialProfile)) {
        throw new Error("Stage 0 coverageProfile is missing or incompatible; preserve this transaction and reissue the run");
      }
      if (execution && digestLineage(canonical.summary?.executionScope) !== digestLineage(execution.descriptor)) {
        throw new Error("Stage 0 execution scope descriptor is missing or incompatible; preserve the pending transaction and state, and reissue the stage in a separately coordinated run. Do not reset or rebind advanced state automatically");
      }
    },
    async prepare(outputDir, previous, archived) {
      if (previous && (previous.canonical.stage !== stage || !previous.canonical.summary.repositoryScope
          || digestLineage(previous.canonical.summary.repositoryScope) !== digestLineage(request.repositoryScope))) {
        throw new Error("Partial artifact has missing or different scope/stage; reissue the stage and dependent artifacts without modifying the original");
      }
      const active = options.stateFile ? session.assertStage(stage).state : null;
      const transitionArtifact = request.transitionArtifact ? require("../../../shared/artifacts/src/artifact_location.js").canonicalResultPath(path.resolve(request.artifactBase || process.cwd(), request.transitionArtifact)) : active?.canonicalArtifact;
      if (active?.canonicalArtifact && transitionArtifact && transitionArtifact !== active.canonicalArtifact) throw new Error("Transition artifact is not the active state revision");
      const stageContext = session.loadStageContext({ stage, previous: previous?.canonical || null,
        repositoryScope: request.repositoryScope, transitionArtifact: active?.canonicalArtifact || request.transitionArtifact,
        artifactBase: request.artifactBase });
      const { lineage } = stageContext;
      const profile = stage === 0 ? initialProfile : require("./coverage_profile.js").coverageProfile(request, lineage);
      const runnerRequest = withRuntimeAstCache({ ...request, ...(transitionArtifact ? { transitionArtifact } : {}), ...(stage === 7 ? { expectedArtifact: active?.canonicalArtifact } : {}) }, outputRoot);
      const sourceSnapshots = [1, 2].includes(stage) ? options.dependencies?.sourceSnapshots || new SourceSnapshotStore() : null;
      const runnerDependencies = { ...(options.dependencies || {}), ...(sourceSnapshots ? { sourceSnapshots } : {}), deferCanonicalization: stage !== 7 };
      const runnerResult = await (options.runner || runnerFor(stage))(runnerRequest, runnerDependencies, stageContext);
      let facts = runnerResult;
      if (stage !== 7) {
        const priorResults = lineage.map(descriptor => JSON.parse(fs.readFileSync(descriptor.artifact, "utf8")));
        const produced = prepareFacts({ ...carryPlanningFacts(request, runnerResult, priorResults), repositoryScope: request.repositoryScope }, { sourceSnapshots });
        const suppliedFacts = canonicalFacts(produced);
        const { checkContext, aliasMap } = require("./check_context.js");
        const context = checkContext(previous, lineage);
        for (const [kind, collection] of [["gap", "gaps"], ["limitation", "limitations"]]) {
          const inherited = context.corrections.filter(row => row.kind === kind);
          if (inherited.length) {
            const merge = Array.isArray(produced.canonicalFacts) || produced.modelType === "inventory-report-model" ? mergeRows : mergePlanningRows;
            produced[collection] = merge([...inherited, ...(produced[collection] || [])], collection);
          }
        }
        const referenced = require("./referenced_evidence.js").referencedEvidence(produced, lineage, request.repositoryScope);
        const evidence = new Map([...context.evidence, ...referenced].map(row => [row.id, row]));
        for (const row of produced.canonicalEvidence || []) {
          const prior = evidence.get(row.id);
          if (!prior) { evidence.set(row.id, row); continue; }
          const priorFile = prior.file || prior.path, file = row.file || row.path;
          if (Boolean(priorFile) !== Boolean(file) || (file && keyOf(prior, { repositoryScope: request.repositoryScope }) !== keyOf(row, { repositoryScope: request.repositoryScope }))) {
            throw new Error(`Conflicting evidence identity: ${row.id}`);
          }
          const confirmed = (value) => (value.status || value.confirmation?.status) === "source-confirmed";
          const winner = confirmed(prior) && !confirmed(row) ? prior : row;
          evidence.set(row.id, { ...winner, aliases: [...new Set([prior.id, ...(prior.aliases || []), row.id, ...(row.aliases || [])])].sort() });
        }
        const remapEvidenceReferences = require("../../../shared/evidence/src/canonicalization/canonicalize.js").remapEvidenceReferences;
        const aliases = aliasMap([...evidence.values()]);
        const remappedProduced = remapEvidenceReferences(produced, aliases);
        const receipts = remapEvidenceReferences(request.checkResolutions || remappedProduced.checkResolutions || [], aliases);
        const resolved = resolveChecks(context.canonical, { ...remappedProduced, ...(request.checkRequirements === undefined ? {} : { checkRequirements: request.checkRequirements }), openChecks: [...new Set([...(request.openChecks || []), ...(remappedProduced.openChecks || [])])] }, receipts, [...evidence.values()], request.repositoryScope);
        assertPlanningOutput({ ...resolved, repositoryScope: request.repositoryScope }, [...evidence.values()], profile, sourceSnapshots, suppliedFacts);
        facts = { ...resolved, repositoryScope: request.repositoryScope, exclusions: execution ? execution.exclusions : request.exclusions || [],
          canonicalEvidence: [...evidence.values()], status: transactionStatus(resolved), runnerStatus: produced.status || "unknown",
          summary: { ...resolved.summary, ...(produced.evidenceDiagnostics?.length ? { evidenceDiagnostics: produced.evidenceDiagnostics } : {}), ...(profile === undefined ? {} : { coverageProfile: profile }), ...(execution ? { executionScope: execution.descriptor } : {}), runnerStatus: produced.status || "unknown", lineage, checkHistory: previous ? [...(previous.canonical.summary.checkHistory || []), { artifact: path.join(archived, "canonical/stage-result.json"), outputDigest: previous.canonical.outputDigest }] : [] } };
      } else {
        // Model mutation here would invalidate the Stage7 digest.
        if (digestLineage(facts.provenance?.lineage) !== digestLineage(lineage)) throw new Error("Stage 7 model must preserve the validated active lineage");
      }
      writeStageArtifact({ outputDir, facts, factsPrepared: stage !== 7, input: request, usage: options.usage, retainRaw: options.retainRaw === true, metrics: options.metrics || {} });
    },
    advance({ resultFile, canonical }, commitOptions = {}) {
      validateCheckHistory(canonical);
      const directory = path.dirname(resultFile);
      const manifest = path.join(directory, "manifest.json");
      if (canonical.status !== "closed") return { status: "partial", stage, artifact: resultFile, manifest, stateChanged: false, runnerStatus: canonical.summary.runnerStatus || "partial" };
      const state = options.stateFile ? session.advanceStage(stage, resultFile, commitOptions) : null;
      return { status: "closed", stage, artifact: resultFile, evidence: path.join(directory, "evidence.json"), manifest, rawRetained: JSON.parse(fs.readFileSync(manifest, "utf8")).retainRaw, stateChanged: Boolean(state?.changed), nextStage: stage + 1 };
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

module.exports = { carryPlanningFacts, defaultOutputRoot, parseArgs, runStagePipeline, runnerFor, runtimeAstCachePath, scopeDigest, slug, transactionStatus, withRuntimeAstCache };
