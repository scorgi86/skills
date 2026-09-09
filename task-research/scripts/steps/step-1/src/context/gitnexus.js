"use strict";
const path = require("node:path");
const { resolveGitNexus } = require("../../../../shared/diagnostics/src/gitnexus_runtime.js");
const { spawnSync } = require("node:child_process");
function compactSymbol(value) {
    return value && {
        uid: value.uid,
        name: value.name,
        kind: value.kind,
        filePath: value.filePath,
        startLine: value.startLine,
        endLine: value.endLine
    };
}
function compactRelations(values, limit = 12) {
    return (Array.isArray(values) ? values : []).slice(0, limit).map(compactSymbol);
}
function parseJson(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) return null;
    try {
        return JSON.parse(trimmed);
    } catch (_) {
        const start = trimmed.lastIndexOf("\n{");
        if (start >= 0) return JSON.parse(trimmed.slice(start + 1));
        throw new Error("GitNexus did not return JSON");
    }
}
function projectGraphContext(raw, seed) {
    const symbol = raw && raw.symbol;
    const incoming = raw && raw.incoming || {};
    const outgoing = raw && raw.outgoing || {};
    const candidates = [
        ...compactRelations(incoming.calls),
        ...compactRelations(incoming.accesses),
        ...compactRelations(outgoing.calls),
        ...compactRelations(outgoing.has_method)
    ];
    return {
        status: raw && raw.status === "found" ? "candidate" : "unresolved",
        seed,
        symbol: compactSymbol(symbol),
        epistemic: raw && raw.epistemic || "unknown",
        incoming: {
            calls: compactRelations(incoming.calls),
            accesses: compactRelations(incoming.accesses)
        },
        outgoing: {
            calls: compactRelations(outgoing.calls),
            has_method: compactRelations(outgoing.has_method)
        },
        candidateCount: candidates.length
    };
}
function gitNexusInvocation(config) {
    const args = [
        "context"
    ];
    if (config.repo) args.push("--repo", String(config.repo));
    if (config.file) args.push("--file", String(config.file));
    if (config.limit) args.push("--limit", String(config.limit));
    args.push(String(config.seed));
    return resolveGitNexus(config, args);
}
function runGitNexusContext(config = {}, dependencies = {}) {
    if (config.enabled === false || !config.seed) return {
        status: "tool-unavailable",
        reason: config.reason || "not-configured",
        requests: []
    };
    const invoke = dependencies.spawnSync || spawnSync;
    let call;
    try { call = gitNexusInvocation(config); } catch(error) { return { status: "tool-unavailable", reason: error.message, requests: [] }; }
    const result = invoke(call.command, call.args, {
        cwd: config.cwd,
        encoding: "utf8",
        windowsHide: true,
        shell: call.shell,
        timeout: config.timeoutMs || 15000
    });
    const request = {
        seed: config.seed,
        command: call.command,
        args: call.args,
        status: "candidate"
    };
    if (result.error || result.status !== 0) {
        request.status = "tool-unavailable";
        request.reason = result.error ? `${result.error.code || "PROCESS_ERROR"}: ${result.error.message}${result.error.code === "EPERM" ? "; process execution denied; use an authorized runtime or record tool-unavailable" : ""}` : String(result.stderr || result.stdout || "GitNexus context failed").trim();
        return {
            status: "tool-unavailable",
            reason: request.reason,
            requests: [
                request
            ]
        };
    }
    try {
        const context = projectGraphContext(parseJson(result.stdout), config.seed);
        request.status = context.status;
        return {
            status: context.status,
            requests: [
                request
            ],
            context
        };
    } catch (error) {
        request.status = "unresolved";
        request.reason = error.message;
        return {
            status: "unresolved",
            reason: error.message,
            requests: [
                request
            ]
        };
    }
}
module.exports = {
    gitNexusInvocation,
    projectGraphContext,
    runGitNexusContext
};
