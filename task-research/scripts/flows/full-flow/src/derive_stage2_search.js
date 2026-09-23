"use strict";
const path = require("node:path");
const { validateCanonicalStageResult } = require("../../../shared/artifacts/src/canonical/validation.js");
const { readCanonicalStageResult } = require("../../../shared/artifacts/src/stage_artifact_v4.js");
const { normalizeRepositoryScope } = require("../../../shared/dto/src/repository_scope.js");
const { scopeDigest } = require("../../../shared/artifacts/src/canonical/checks.js");
const { buildOwnershipGraph, validateOwnershipGraph } = require("../../../shared/ownership/src/ownership_graph.js");

const EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]), MAX_FILES = 200;
const inside = (root, file) => { const relative = path.relative(root, file); return Boolean(relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)); };
const cleanTerms = values => [...new Set((values || []).filter(value => typeof value === "string").map(value => value.normalize("NFC").trim()).filter(Boolean))].sort();

function stage0Lineage(stage1, scope) {
  const link = (stage1.summary.lineage || []).find(row => Number(row.stage) === 0) || (stage1.summary.lineage || [])[0];
  if (!link?.artifact) throw new Error("Stage 2 search requires canonical Stage 0 lineage");
  const stage0 = readCanonicalStageResult(path.resolve(link.artifact));
  if (!validateCanonicalStageResult(stage0).ok || stage0.stage !== 0 || stage0.status !== "closed") throw new Error("Stage 2 search requires a valid closed Stage 0 lineage artifact");
  if (scopeDigest(normalizeRepositoryScope(stage0.summary.repositoryScope, { requireExisting: false })) !== scopeDigest(scope)) throw new Error("Stage 0 lineage repository scope differs from Stage 2");
  if (stage0.summary.executionScope?.scanSeeds !== true) throw new Error("Stage 2 search requires Stage 0 scanSeeds: true");
  return stage0;
}

function candidateFiles(stage0, repo) {
  const all = stage0.facts.filter(row => row.kind === "candidate-file" && row.repository === repo.id).map(row => row.file);
  const scan = (stage0.summary.repos || []).find(row => row.id === repo.id);
  if (!scan || scan.status !== "candidate" || scan.files !== all.length) throw new Error(`Stage 0 ${repo.id} scan is incomplete`);
  const files = [...new Set(all)].filter(file => EXTENSIONS.has(path.extname(file).toLowerCase())).sort();
  if (files.length > MAX_FILES) throw new Error(`Stage 0 ${repo.id} exceeds the automatic Stage 2 file limit of ${MAX_FILES}`);
  if (files.some(file => !path.isAbsolute(file) || !inside(repo.root, file))) throw new Error(`Stage 0 ${repo.id} has an out-of-scope JS/TS candidate`);
  return files;
}

function deriveStage2Search(stage1, repositoryScope, maxOrder) {
  if (!validateCanonicalStageResult(stage1).ok || stage1.stage !== 1 || stage1.status !== "closed") throw new Error("Stage 2 search requires a valid closed Stage 1 artifact");
  if (!Number.isInteger(maxOrder) || maxOrder < 0) throw new Error("Stage 2 automatic search requires ownershipGraphMaxOrder >= 0");
  const scope = normalizeRepositoryScope(repositoryScope, { requireExisting: false });
  if (scopeDigest(scope) !== scopeDigest(normalizeRepositoryScope(stage1.summary.repositoryScope, { requireExisting: false }))) throw new Error("Stage 2 search repository scope differs from Stage 1");
  const nodes = stage1.facts.filter(row => row.kind === "ownership-node").map(({ kind, ...row }) => row);
  const edges = stage1.facts.filter(row => row.kind === "ownership-edge").map(({ kind, ...row }) => row);
  if (!nodes.length) throw new Error("Stage 1 canonical ownership graph is missing");
  if (edges.some(edge => edge.status !== "confirmed")) throw new Error("Stage 1 ownership graph contains an unconfirmed edge");
  const highest = Math.max(...nodes.map(node => node.order ?? -1));
  if (maxOrder < highest) throw new Error("ownershipGraphMaxOrder is below the existing ownership order");
  const ownershipGraph = buildOwnershipGraph({ nodes, edges, maxOrder });
  const graphValidation = validateOwnershipGraph(ownershipGraph);
  if (!graphValidation.ok) throw new Error(`Stage 1 ownership graph is invalid: ${graphValidation.errors.join("; ")}`);
  const stage0 = stage0Lineage(stage1, scope), discoveryTerms = cleanTerms(stage0.summary.seeds);
  const valueFlowEnabled = ["full-inventory", "full-development"].includes(stage0.summary.coverageProfile?.kind);
  if (!discoveryTerms.length) throw new Error("Stage 0 canonical discovery terms are missing");
  const filesByRepo = new Map(scope.repositories.map(repo => [repo.id, candidateFiles(stage0, repo)]));
  const valueFlowRoots=cleanTerms([...discoveryTerms,...nodes.map(node=>node.entity)]);
  let frontier = [];
  if (highest < maxOrder) frontier = ownershipGraph.nodes.filter(node => node.order === highest).map(node => {
    const incident = ownershipGraph.edges.filter(edge => edge.status === "confirmed" && (edge.from === node.id || edge.to === node.id));
    const repositories = new Set();
    for (const edge of incident) for (const anchor of edge.anchors || []) {
      const matches = scope.repositories.filter(repo => inside(repo.root, path.resolve(anchor.file || "")));
      if (matches.length !== 1) throw new Error(`${node.id}: ownership anchor does not identify one repository`);
      repositories.add(matches[0].id);
    }
    if (!incident.length || repositories.size !== 1) throw new Error(`${node.id}: ownership frontier repository is missing or ambiguous`);
    return { nodeId: node.id, entity: node.entity, order: node.order, repository: [...repositories][0] };
  }).sort((a,b)=>a.repository.localeCompare(b.repository)||a.entity.localeCompare(b.entity));
  const frontierExhausted = highest >= maxOrder || !frontier.length;
  const queries = [];
  for (const repo of scope.repositories) {
    const files = filesByRepo.get(repo.id);
    if (files.length) queries.push({ id: `stage0-boundary-${repo.id}`, command: "occurrences", files, options: { terms: discoveryTerms }, includeDetails: true, maxDetails: Number.MAX_SAFE_INTEGER, maxGroups: Number.MAX_SAFE_INTEGER });
    if (valueFlowEnabled && files.length) queries.push({ id: `value-flow-${repo.id}`, command: "relations", files, options:{terms:valueFlowRoots.join(",")}, includeDetails: true, maxDetails: 10000, maxGroups: 10000, maxSnippetChars: 2000 });
    const ownerTerms = cleanTerms(frontier.filter(row => row.repository === repo.id).map(row => row.entity));
    if (ownerTerms.length && files.length) queries.push({ id: `stage1-frontier-${repo.id}`, command: "find", files, options: { terms: ownerTerms.join(",") } });
  }
  if (!queries.length) throw new Error("Stage 2 has no searchable JS/TS files");
  const ownerQueries = queries.filter(row => row.id.startsWith("stage1-frontier-"));
  const checks = ownerQueries.map(query => ({ id: query.id, repository: query.id.slice("stage1-frontier-".length), files: query.files, extensions: [...EXTENSIONS], maxFiles: query.files.length, patterns: String(query.options.terms).split(",").map(value => ({ value, regex: false })) }));
  const roles = { producerRepos: scope.repositories.filter(repo => ["producer", "source"].includes(repo.role)).map(repo => repo.id), consumerRepos: scope.repositories.filter(repo => repo.role === "consumer").map(repo => repo.id) };
  return { ownershipGraph, ownershipGraphMaxOrder: maxOrder, ownershipFrontier: frontier, frontierExhausted,
    boundaryDiscovery: { terms: discoveryTerms, roles }, valueFlow: { enabled:valueFlowEnabled, roots:valueFlowRoots },
    ast: { queries, ownerSeedTypes: cleanTerms(frontier.map(row => row.entity)), ownerSeedScopes: frontier.map(({ entity: seed, repository }) => ({ seed, repository })), ownerRepositories: scope.repositories }, evidence: { checks } };
}

module.exports = { deriveStage2Search };
