"use strict";

const childProcess = require("node:child_process");

const path = require("node:path");

const crypto = require("node:crypto");

const { extractTransition } = require("../../../shared/dto/src/extract_stage_transition.js");

const fs = require("node:fs");
const { transitionForRequest } = require("../../../state/src/session/inventory_session.js");

function git(repo, args, dependencies = {}) {
  const result = (dependencies.spawnSync || childProcess.spawnSync)("git", ["-C", path.resolve(repo), ...args], { encoding: "utf8", windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`git ${args[0]} failed: ${String(result.stderr || result.error?.message || "").trim()}`);
  return String(result.stdout || "").trim();
}

function digest(value) { return crypto.createHash("sha256").update(value).digest("hex"); }

function parseNameStatus(text) { return text.split(/\r?\n/).filter(Boolean).map((line) => { const [status, ...rest] = line.split("\t"); return { status, path: rest.at(-1) }; }); }

function parseRawNameStatus(text) { return text.split(/\r?\n/).filter(Boolean).map((line) => { const match = line.match(/^:[0-7]+ [0-7]+ [0-9a-f]+ [0-9a-f]+ ([A-Z][0-9]*)\t(.+)$/); return match ? { status: match[1], path: match[2] } : null; }).filter(Boolean); }

function splitPatchSections(patch) { const sections = new Map(); const chunks = patch.split(/^diff --git a\/(.*?) b\/.*$/m); for (let index = 1; index < chunks.length; index += 2) sections.set(chunks[index], `diff --git a/${chunks[index]} b/${chunks[index + 1]}`); return sections; }

function normalizeSurfaces(items) { if (!Array.isArray(items) || !items.length) throw new Error("Stage 6 requires declared sourceSurfaces"); return items.map((item) => { if (!item.path || !item.layer || !item.role) throw new Error("Each source surface requires path, layer, role"); return { ...item, path: String(item.path), layer: String(item.layer), role: String(item.role), evidenceRefs: item.evidenceRefs || [] }; }); }

function resolveMode(request) { return request.mode || (request.featureReference ? "feature-reference" : request.reference?.from || request.reference?.to ? "commit-range" : "commit-range"); }

function featureReference(request, transition, surfaces) {
  const feature = request.featureReference || {};
  if (!feature.target || !feature.referenceEntity || !Array.isArray(feature.capabilities) || !feature.capabilities.length) throw new Error("feature-reference requires target, referenceEntity, and capabilities");
  return { schemaVersion: "2.0.0", stage: 6, status: "candidate", mode: "feature-reference", transition, reference: { target: feature.target, referenceEntity: feature.referenceEntity, sourcePathsDigest: digest(surfaces.map((item) => item.path).sort().join("\n")) }, sourceSurfaces: surfaces.map((surface) => ({ ...surface, confirmed: false })), capabilities: require("../../../shared/dto/src/capability_contract.js").normalizeCapabilities(feature.capabilities), priorArtifacts: request.priorArtifacts || [], openChecks: request.openChecks || [] };
}

function attachEvidence(facts, request, previous) {
  previous = previous || JSON.parse(fs.readFileSync(path.resolve(request.transitionArtifact), "utf8"));
  const sourceEvidence = request.sourceEvidence || (request.evidence ? require("../../../shared/evidence/src/collection/source_evidence.js").runEvidenceChecks({ ...request.evidence, retainAllMatches: true }) : undefined);
  const prepared = require("../../../shared/artifacts/src/canonical/facts.js").prepareFacts({ ...facts, repositoryScope: request.repositoryScope || previous.summary?.repositoryScope, repository: request.repository, canonicalEvidence: request.canonicalEvidence || [], sourceEvidence });
  const confirmed = new Set((prepared.canonicalEvidence || []).filter(e=>e.confirmation?.status === "source-confirmed").map(e=>e.id));
  prepared.sourceSurfaces = prepared.sourceSurfaces.map(surface=>({ ...surface, confirmed: surface.evidenceRefs.length > 0 && surface.evidenceRefs.every(id=>confirmed.has(id)) }));
  return prepared;
}
function runStage6(request, dependencies = {}, context = null) {
  if (Number(request && request.stage) !== 6 || !request.transitionArtifact) throw new Error("Stage 6 requires stage and transitionArtifact");
  const previous = transitionForRequest(context, request) || JSON.parse(fs.readFileSync(path.resolve(request.transitionArtifact), "utf8"));
  const transition = extractTransition(previous);
  const surfaces = normalizeSurfaces(request.sourceSurfaces);
  const mode = resolveMode(request);
  if (mode === "feature-reference") return attachEvidence(featureReference(request, transition, surfaces), request, previous);
  if (!["worktree-diff", "commit-range"].includes(mode) || !request.reference?.repo) throw new Error("Stage 6 mode must be feature-reference, worktree-diff, or commit-range");
  if (mode === "worktree-diff") {
    const base = request.reference.base || "HEAD";
    const rawAndPatch = git(request.reference.repo, ["diff", "--raw", "--patch", "--unified=0", base], dependencies);
    return attachEvidence(buildDiffResult({ request, transition, surfaces, mode, rawAndPatch, metadata: { commit: null, parent: base, subject: "worktree" } }), request, previous);
  }
  const ref = request.reference.to || request.reference.ref;
  if (!ref) throw new Error("commit-range requires reference.ref or reference.to");
  const metadata = git(request.reference.repo, ["show", "-s", "--format=%H%x00%P%x00%s", ref], dependencies).split("\0");
  const [commit, parents, subject] = metadata;
  const parent = request.reference.from || parents.split(" ")[0];
  const rawAndPatch = git(request.reference.repo, ["diff", "--raw", "--patch", "--unified=0", parent, commit], dependencies);
  return attachEvidence(buildDiffResult({ request, transition, surfaces, mode, rawAndPatch, metadata: { commit, parent, subject } }), request, previous);
}

function buildDiffResult({ request, transition, surfaces, mode, rawAndPatch, metadata }) {
  const patchStart = rawAndPatch.indexOf("\ndiff --git ");
  const raw = patchStart < 0 ? rawAndPatch : rawAndPatch.slice(0, patchStart);
  const fullPatch = patchStart < 0 ? "" : rawAndPatch.slice(patchStart + 1);
  const changedFiles = parseRawNameStatus(raw);
  const sections = splitPatchSections(fullPatch);
  const surfaceFacts = surfaces.map((surface) => {
    const diff = sections.get(surface.path) || "";
    const anchors = diff.split(/\r?\n/).filter((line) => /^@@|^\+\+\+|^---/.test(line));
    return { ...surface, changed: Boolean(diff), patchSha256: digest(diff.trim()), anchors };
  });
  return { schemaVersion: "2.0.0", stage: 6, status: "candidate", mode, transition, reference: { repo: path.resolve(request.reference.repo), ref: request.reference.ref || request.reference.to || metadata.parent, commit: metadata.commit, parent: metadata.parent, subject: metadata.subject, changedFiles: changedFiles.length, patchFormat: "unified=0", patchSha256: digest(fullPatch.trim()) }, sourceSurfaces: surfaceFacts, capabilities: require("../../../shared/dto/src/capability_contract.js").normalizeCapabilities(request.capabilities || []), priorArtifacts: request.priorArtifacts || [], openChecks: request.openChecks || [] };
}

function buildSummary(result, output) { return { schemaVersion: result.schemaVersion, stage: result.stage, status: result.status, mode: result.mode, output: path.resolve(output), reference: { commit: result.reference.commit || null, changedFiles: result.reference.changedFiles ?? null, patchSha256: result.reference.patchSha256 || result.reference.sourcePathsDigest }, sourceSurfaces: { declared: result.sourceSurfaces.length, changed: result.sourceSurfaces.filter((surface) => surface.changed).length, aggregateSha256: digest(result.sourceSurfaces.map((surface) => `${surface.path}\u001f${surface.patchSha256 || surface.confirmed}`).join("\n")) }, openChecks: result.openChecks }; }

module.exports = { buildDiffResult, buildSummary, featureReference, parseNameStatus, parseRawNameStatus, resolveMode, runStage6, splitPatchSections };
