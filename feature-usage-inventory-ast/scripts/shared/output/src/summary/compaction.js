const path = require("path");

function anchorHolders(summary) {
  const holders = [];
  for (const query of summary.ast && summary.ast.queries || []) {
    for (const group of query.groups || []) if (group.firstAnchor) holders.push(group);
  }
  for (const check of summary.sourceEvidence || []) {
    for (const group of check.groups || []) if (group.firstAnchor) holders.push(group);
  }
  return holders;
}

function anchorFile(anchor) {
  return anchor && typeof anchor.file === "string" ? path.resolve(anchor.file) : null;
}

function commonDirectory(files) {
  if (!files.length) return null;
  const roots = new Set(files.map((file) => path.parse(file).root.toLowerCase()));
  if (roots.size !== 1) return null;
  let common = path.dirname(files[0]);
  while (common && !files.every((file) => file === common || file.startsWith(`${common}${path.sep}`))) {
    const parent = path.dirname(common);
    if (parent === common) return null;
    common = parent;
  }
  return common || null;
}

function compactAnchor(anchor, fileId) {
  const line = anchor.line ?? (anchor.range && anchor.range.start && anchor.range.start.line) ?? null;
  const endLine = anchor.range && anchor.range.end && anchor.range.end.line;
  const compact = { fileId, line };
  if (Number.isFinite(endLine) && endLine !== line) compact.endLine = endLine;
  return compact;
}

function compactSummaryAnchors(summary, options = {}) {
  const holders = anchorHolders(summary);
  const absoluteFiles = [...new Set(holders.map((holder) => anchorFile(holder.firstAnchor)).filter(Boolean))].sort();
  if (!absoluteFiles.length) return { compacted: false, anchors: 0, files: 0 };
  const root = options.anchorRoot ? path.resolve(options.anchorRoot) : commonDirectory(absoluteFiles);
  const paths = absoluteFiles.map((file) => root ? path.relative(root, file) || path.basename(file) : file);
  const ids = new Map(absoluteFiles.map((file, index) => [file, index]));
  let anchors = 0;
  for (const holder of holders) {
    const file = anchorFile(holder.firstAnchor);
    if (!file || !ids.has(file)) continue;
    holder.firstAnchor = compactAnchor(holder.firstAnchor, ids.get(file));
    anchors += 1;
  }
  summary.anchorFiles = { root, paths };
  return { compacted: true, anchors, files: paths.length };
}

function resolveCompactAnchor(summary, anchor) {
  if (!anchor || anchor.fileId === undefined) return anchor;
  const table = summary.anchorFiles;
  if (!table || !Array.isArray(table.paths) || !table.paths[anchor.fileId]) return null;
  const stored = table.paths[anchor.fileId];
  const file = table.root ? path.resolve(table.root, stored) : path.resolve(stored);
  return { file, line: anchor.line, endLine: anchor.endLine };
}

module.exports = { anchorHolders, commonDirectory, compactAnchor, compactSummaryAnchors, resolveCompactAnchor };
