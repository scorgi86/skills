#!/usr/bin/env node
"use strict";
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { extractTransition } = require("./extract_stage_transition");

function git(repo, args, dependencies = {}) {
  const result = (dependencies.spawnSync || childProcess.spawnSync)("git", ["-C", path.resolve(repo), ...args], { encoding: "utf8", windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`git ${args[0]} failed: ${String(result.stderr || result.error?.message || "").trim()}`);
  return String(result.stdout || "").trim();
}
function digest(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function parseNameStatus(text) { return text.split(/\r?\n/).filter(Boolean).map((line) => { const [status, ...rest] = line.split("\t"); return { status, path: rest.at(-1) }; }); }
function parseRawNameStatus(text) { return text.split(/\r?\n/).filter(Boolean).map((line) => { const match = line.match(/^:[0-7]+ [0-7]+ [0-9a-f]+ [0-9a-f]+ ([A-Z][0-9]*)\t(.+)$/); return match ? { status: match[1], path: match[2] } : null; }).filter(Boolean); }
function splitPatchSections(patch) { const sections = new Map(); const chunks = patch.split(/^diff --git a\/(.*?) b\/.*$/m); for (let index = 1; index < chunks.length; index += 2) sections.set(chunks[index], `diff --git a/${chunks[index]} b/${chunks[index + 1]}`); return sections; }
function normalizeSurfaces(items) { if (!Array.isArray(items) || !items.length) throw new Error("Stage 6 requires declared sourceSurfaces"); return items.map((item) => { if (!item.path || !item.layer || !item.role) throw new Error("Each source surface requires path, layer, role"); return { path: String(item.path), layer: String(item.layer), role: String(item.role) }; }); }
function runStage6(request, dependencies = {}) {
  if (Number(request && request.stage) !== 6 || !request.transitionArtifact || !request.reference?.repo || !request.reference?.ref) throw new Error("Stage 6 requires stage, transitionArtifact, and reference repo/ref");
  const transition = extractTransition(fs.readFileSync(path.resolve(request.transitionArtifact), "utf8"));
  const surfaces = normalizeSurfaces(request.sourceSurfaces);
  const metadata = git(request.reference.repo, ["show", "-s", "--format=%H%x00%P%x00%s", request.reference.ref], dependencies).split("\0");
  const [commit, parents, subject] = metadata;
  const parent = parents.split(" ")[0];
  const rawAndPatch = git(request.reference.repo, ["diff", "--raw", "--patch", "--unified=0", parent, commit], dependencies);
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
  return { schemaVersion: "1.0.0", stage: 6, status: "candidate", transition, reference: { repo: path.resolve(request.reference.repo), ref: request.reference.ref, commit, parent, subject, changedFiles: changedFiles.length, patchFormat: "unified=0", patchSha256: digest(fullPatch.trim()) }, sourceSurfaces: surfaceFacts, capabilities: require("./capability_contract").normalizeCapabilities(request.capabilities || []), priorArtifacts: request.priorArtifacts || [], openChecks: request.openChecks || [] };
}
function buildSummary(result, output) { return { schemaVersion: result.schemaVersion, stage: result.stage, status: result.status, output: path.resolve(output), reference: { commit: result.reference.commit, changedFiles: result.reference.changedFiles, patchSha256: result.reference.patchSha256 }, sourceSurfaces: { declared: result.sourceSurfaces.length, changed: result.sourceSurfaces.filter((surface) => surface.changed).length, aggregateSha256: digest(result.sourceSurfaces.map((surface) => `${surface.path}\u001f${surface.patchSha256}`).join("\n")) }, openChecks: result.openChecks }; }
function main() { try { const args = process.argv.slice(2); const get = (flag) => args[args.indexOf(flag) + 1]; const request = get("--request"); if (!request) throw new Error("Provide --request <json-file>"); const result = runStage6(JSON.parse(fs.readFileSync(path.resolve(request), "utf8"))); const output = get("--output"); if (output) { fs.writeFileSync(path.resolve(output), `${JSON.stringify(result, null, 2)}\n`); process.stdout.write(`${JSON.stringify(buildSummary(result, output))}\n`); } else process.stdout.write(`${JSON.stringify(result)}\n`); } catch (error) { process.stdout.write(`${JSON.stringify({ status: "error", errors: [{ message: error.message }] })}\n`); process.exitCode = 2; } }
if (require.main === module) main();
module.exports = { buildSummary, parseNameStatus, parseRawNameStatus, runStage6, splitPatchSections };
