#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const args = { feature: "target feature", scope: "current workspace", out: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--feature") args.feature = argv[++i] || args.feature;
    else if (arg === "--scope") args.scope = argv[++i] || args.scope;
    else if (arg === "--out") args.out = argv[++i] || "";
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node report_scaffold.js --feature <name> [--scope <scope>] [--out report.md]");
      process.exit(0);
    }
  }
  return args;
}

function loadTemplate() {
  const templatePath = path.resolve(__dirname, "..", "references", "inventory-report-template.md");
  return fs.readFileSync(templatePath, "utf8").replace(/^\uFEFF/, "");
}

function buildReport(args) {
  const template = loadTemplate();
  return [
    `# Inventory Report: ${args.feature}`,
    "",
    `Scope: ${args.scope}`,
    "",
    template,
  ].join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = buildReport(args);
  if (args.out) {
    fs.writeFileSync(args.out, report, "utf8");
  } else {
    process.stdout.write(report);
  }
}

main();
