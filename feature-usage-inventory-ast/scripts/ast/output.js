const crypto = require("crypto");

const DEFAULT_OUTPUT_BUDGET = 32 * 1024;

function byteLength(value, spacing = 0) {
  return Buffer.byteLength(JSON.stringify(value, null, spacing), "utf8");
}

function semanticParts(item = {}) {
  return {
    owner: item.ownerQualifiedName || item.owner || item.scope || "<module>",
    relation: item.relation || item.kind || "unknown",
    field: item.field || item.method || item.name || "",
    target: item.targetQualifiedName || item.inferredType || item.candidateType || item.qualifiedName || "unknown",
  };
}

function semanticSignature(item) {
  const parts = semanticParts(item);
  return [parts.owner, parts.relation, parts.field, parts.target].join("\u001f");
}

function groupKey(item) {
  return `g-${crypto.createHash("sha256").update(semanticSignature(item)).digest("hex").slice(0, 12)}`;
}

function truncateText(value, maxChars) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function compactEvidence(evidence, maxSnippetChars) {
  if (!evidence || typeof evidence !== "object") return evidence;
  const compact = { ...evidence };
  if (Object.prototype.hasOwnProperty.call(compact, "snippet")) compact.snippet = truncateText(compact.snippet, maxSnippetChars);
  return compact;
}

function compactItem(item, maxEvidencePerItem, maxSnippetChars) {
  const compact = { ...item };
  const evidence = Array.isArray(item.evidence) ? item.evidence : [];
  compact.evidence = evidence.slice(0, maxEvidencePerItem).map((entry) => compactEvidence(entry, maxSnippetChars));
  if (evidence.length > compact.evidence.length) {
    compact.evidenceTotal = evidence.length;
    compact.evidenceSuppressed = evidence.length - compact.evidence.length;
  }
  compact.groupKey = groupKey(item);
  return compact;
}

function countEvidence(items) {
  return items.reduce((total, item) => total + (Array.isArray(item.evidence) ? item.evidence.length : 0), 0);
}

function groupItems(items, maxSnippetChars) {
  const groups = new Map();
  for (const item of items) {
    const key = groupKey(item);
    let group = groups.get(key);
    if (!group) {
      const parts = semanticParts(item);
      group = { key, ...parts, items: 0, evidence: 0, sourceSymbols: new Set(), example: null };
      groups.set(key, group);
    }
    group.items += 1;
    group.evidence += Array.isArray(item.evidence) ? item.evidence.length : 0;
    if (item.sourceSymbol) group.sourceSymbols.add(item.sourceSymbol);
    if (!group.example && Array.isArray(item.evidence) && item.evidence[0]) group.example = compactEvidence(item.evidence[0], maxSnippetChars);
  }
  return [...groups.values()].map((group) => ({
    key: group.key,
    owner: group.owner,
    relation: group.relation,
    field: group.field,
    target: group.target,
    items: group.items,
    evidence: group.evidence,
    sourceSymbols: group.sourceSymbols.size,
    example: group.example,
  }));
}

function splitFilterValues(value) {
  if (Array.isArray(value)) return value.flatMap(splitFilterValues);
  return String(value || "").split(",").map((part) => part.trim()).filter(Boolean);
}

function wildcardPattern(value) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function matchesFilter(actual, expected) {
  const values = splitFilterValues(expected);
  return !values.length || values.some((value) => wildcardPattern(value).test(String(actual || "")));
}

function filterSemanticGroups(groups, filters = {}) {
  return groups.filter((group) =>
    matchesFilter(group.owner, filters.groupOwner)
    && matchesFilter(group.field, filters.groupField)
    && matchesFilter(group.relation, filters.groupRelation)
    && matchesFilter(group.target, filters.groupTarget));
}

function visibleCollection(data) {
  if (!data || typeof data !== "object") return null;
  for (const key of ["items", "owners", "recipients"]) {
    if (Array.isArray(data[key])) return { key, items: data[key] };
  }
  return null;
}

function sourceItems(data) {
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data._allItems)) return data._allItems;
  const visible = visibleCollection(data);
  if (visible) return visible.items;
  if (Array.isArray(data.relations) || Array.isArray(data.symbols)) return [...(data.symbols || []), ...(data.relations || [])];
  return [];
}

function replaceAnalyzeArrays(data, items) {
  const keep = new Set(["file", "parser", "status", "warnings", "errors", "elapsedMs"]);
  for (const key of Object.keys(data)) {
    if (Array.isArray(data[key]) && !keep.has(key)) delete data[key];
  }
  data.items = items;
}

function setVisibleItems(data, items) {
  const visible = visibleCollection(data);
  if (visible) data[visible.key] = items;
  else replaceAnalyzeArrays(data, items);
  data.returned = items.length;
}

function recommendedQueries(output, coverage, firstGroup) {
  const command = output.command || "summary";
  const queries = [];
  if (coverage.nextGroupOffset !== null) queries.push(`${command} <same scope/options> --output-mode summary --group-offset ${coverage.nextGroupOffset}`);
  if (firstGroup) queries.push(`${command} <same scope/options> --details-for ${firstGroup.key} --output-mode detail`);
  return queries;
}

function measure(output, spacing) {
  let previous = -1;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = byteLength(output, spacing);
    output.coverage.outputBytes = current;
    if (current === previous) break;
    previous = current;
  }
  return byteLength(output, spacing);
}

function applyOutputPolicy(output, options = {}) {
  if (!output || !output.data || ["help", "doctor", "stats"].includes(output.command)) return output;
  const spacing = options.format === "pretty" ? 2 : 0;
  const budget = Math.max(2048, Number(options.maxOutputBytes) || DEFAULT_OUTPUT_BUDGET);
  const maxEvidence = Number.isFinite(Number(options.maxEvidencePerItem)) ? Math.max(0, Number(options.maxEvidencePerItem)) : 3;
  const maxSnippet = Number.isFinite(Number(options.maxSnippetChars)) ? Math.max(0, Number(options.maxSnippetChars)) : 160;
  const maxGroups = Math.max(1, Number(options.maxGroups) || 100);
  const groupOffset = Math.max(0, Number(options.groupOffset) || 0);
  const requested = options.detailsFor ? "detail" : options.outputMode || "auto";
  const allItems = sourceItems(output.data);
  if (!allItems.length) return output;

  const groups = groupItems(allItems, maxSnippet);
  const filteredGroups = filterSemanticGroups(groups, options);
  const hasGroupFilters = ["groupOwner", "groupField", "groupRelation", "groupTarget"].some((key) => splitFilterValues(options[key]).length);
  const rawBytes = byteLength(output, spacing);
  const originalVisible = visibleCollection(output.data);
  const originalItems = originalVisible ? originalVisible.items : allItems;
  const coverage = {
    modeRequested: requested,
    modeApplied: "detail",
    totalItems: allItems.length,
    itemsReturned: originalItems.length,
    uniqueGroups: groups.length,
    groupsScanned: groups.length,
    groupsMatched: filteredGroups.length,
    groupOffset,
    groupsReturned: 0,
    groupsTruncated: false,
    nextGroupOffset: null,
    evidenceTotal: countEvidence(allItems),
    evidenceReturned: countEvidence(originalItems),
    evidenceSuppressed: 0,
    rawOutputBytes: rawBytes,
    outputBytes: 0,
    outputBudget: budget,
  };
  output.coverage = coverage;

  const rawFits = requested === "auto" && !hasGroupFilters && byteLength(output, spacing) <= budget;
  if (!rawFits) {
    const detailRequested = requested === "detail";
    coverage.modeApplied = detailRequested ? "detail" : "summary";
    let returnedItems = detailRequested ? originalItems.map((item) => compactItem(item, maxEvidence, maxSnippet)) : [];
    setVisibleItems(output.data, returnedItems);
    let page = filteredGroups.slice(groupOffset, groupOffset + maxGroups);
    output.data.groups = page;

    const recalculate = () => {
      coverage.itemsReturned = returnedItems.length;
      coverage.groupsReturned = page.length;
      coverage.groupsTruncated = groupOffset > 0 || groupOffset + page.length < filteredGroups.length;
      coverage.nextGroupOffset = groupOffset + page.length < filteredGroups.length ? groupOffset + page.length : null;
      coverage.evidenceReturned = countEvidence(returnedItems);
      coverage.evidenceSuppressed = Math.max(0, coverage.evidenceTotal - coverage.evidenceReturned);
      output.recommendedQueries = recommendedQueries(output, coverage, page[0] || filteredGroups[0]);
      measure(output, spacing);
    };

    recalculate();
    while (coverage.outputBytes > budget && page.length > 1) {
      page = page.slice(0, Math.max(1, Math.floor(page.length * 0.75)));
      output.data.groups = page;
      recalculate();
    }
    while (coverage.outputBytes > budget && returnedItems.length > 1) {
      returnedItems = returnedItems.slice(0, Math.max(1, Math.floor(returnedItems.length * 0.75)));
      setVisibleItems(output.data, returnedItems);
      recalculate();
    }
    if (coverage.outputBytes > budget && page.length) {
      page = page.map((group) => ({ ...group, example: group.example ? { file: group.example.file, range: group.example.range } : null }));
      output.data.groups = page;
      recalculate();
    }
    if (coverage.outputBytes > budget && returnedItems.length) {
      returnedItems = returnedItems.map((item) => compactItem(item, 0, 0));
      setVisibleItems(output.data, returnedItems);
      recalculate();
    }
    if (coverage.outputBytes > budget) {
      output.warnings = [...(output.warnings || []), { code: "output-budget-exceeded", message: `Minimum useful response exceeds ${budget} bytes; narrow the query or raise --max-output-bytes.` }];
      recalculate();
    } else {
      output.warnings = [...(output.warnings || []), { code: "adaptive-output", message: `Raw output was ${rawBytes} bytes; presentation was compacted without truncating the internal analysis.` }];
      recalculate();
    }
    while (coverage.outputBytes > budget && page.length) {
      page = page.slice(0, -1);
      output.data.groups = page;
      recalculate();
    }
    while (coverage.outputBytes > budget && returnedItems.length) {
      returnedItems = returnedItems.slice(0, -1);
      setVisibleItems(output.data, returnedItems);
      recalculate();
    }
  } else {
    coverage.evidenceSuppressed = 0;
    measure(output, spacing);
  }
  return output;
}

module.exports = {
  DEFAULT_OUTPUT_BUDGET,
  applyOutputPolicy,
  byteLength,
  compactItem,
  filterSemanticGroups,
  groupItems,
  groupKey,
  semanticSignature,
};
