"use strict";
const fs = require("fs");
const { splitTerms, runSearch, toMarkdown } = require("../../../shared/search/src/inventory_search.js");
function parseArgs(argv) {
    const args = {
        groups: [],
        scopes: [],
        excludePatterns: [],
        json: false,
        ignoreCase: true,
        regex: false,
        includeNoise: false,
        limit: 1000,
        out: ""
    };
    for(let i = 0; i < argv.length; i += 1){
        const arg = argv[i];
        if (arg === "--term") args.groups.push({
            group: "seed",
            terms: [
                argv[++i]
            ]
        });
        else if (arg === "--terms" || arg === "--seed") args.groups.push({
            group: "seed",
            terms: splitTerms(argv[++i])
        });
        else if (arg === "--owner") args.groups.push({
            group: "owner",
            terms: splitTerms(argv[++i])
        });
        else if (arg === "--recipient") args.groups.push({
            group: "recipient",
            terms: splitTerms(argv[++i])
        });
        else if (arg === "--analog") args.groups.push({
            group: "analog",
            terms: splitTerms(argv[++i])
        });
        else if (arg === "--group") {
            const raw = argv[++i] || "";
            const idx = raw.indexOf(":");
            args.groups.push({
                group: idx >= 0 ? raw.slice(0, idx) : "custom",
                terms: splitTerms(idx >= 0 ? raw.slice(idx + 1) : raw)
            });
        } else if (arg === "--scope") args.scopes.push(argv[++i]);
        else if (arg === "--exclude-regex") args.excludePatterns.push(new RegExp(argv[++i]));
        else if (arg === "--json") args.json = true;
        else if (arg === "--case-sensitive") args.ignoreCase = false;
        else if (arg === "--regex") args.regex = true;
        else if (arg === "--include-noise") args.includeNoise = true;
        else if (arg === "--limit") args.limit = Number(argv[++i]) || args.limit;
        else if (arg === "--out") args.out = argv[++i] || "";
        else if (arg === "--follow-links" || arg === "--no-follow-links") {} else // File-system traversal is native in this script; kept for CLI compatibility.
        if (arg === "--help" || arg === "-h") {
            usage();
            process.exit(0);
        } else {
            args.groups.push({
                group: "seed",
                terms: [
                    arg
                ]
            });
        }
    }
    if (args.scopes.length === 0) throw new Error("Search roots are required. Ask the user for the folders to search.");
    args.groups = args.groups.map((g)=>({
            group: g.group || "seed",
            terms: (g.terms || []).filter(Boolean)
        })).filter((g)=>g.terms.length);
    return args;
}
function usage() {
    console.log(`Usage:
  node scripts/cli/src/commands/inventory_search.js --seed TargetFeature --owner FeatureContainer --scope <repository-root>

Options:
  --seed a,b          direct target terms
  --owner a,b         owner/container terms
  --recipient a,b     recipient/object-family terms
  --analog a,b        analogous mechanism terms
  --group name:a,b    custom group
  --scope path        repeatable search scope
  --exclude-regex re  repeatable caller-declared path exclusion
  --include-noise     ignore caller-declared path exclusions
  --regex             treat terms as regex
  path search         file and directory names are searched automatically
  --json              emit JSON
  --out file          write output to file as UTF-8
`);
}
function main() {
    const args = parseArgs(process.argv.slice(2));
    if (!args.groups.length) {
        console.error("ERROR: pass at least one term group");
        usage();
        process.exit(2);
    }
    const output = runSearch(args);
    const rendered = args.json ? JSON.stringify(output, null, 2) : toMarkdown(output);
    if (args.out) fs.writeFileSync(args.out, rendered, "utf8");
    else console.log(rendered);
}
module.exports = main;
if (require.main === module) main();
