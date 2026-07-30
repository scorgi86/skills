#!/usr/bin/env node

const fs = require("fs");

function parseArgs(argv) {
  const args = { input: "", feature: "target feature", out: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input") args.input = argv[++i] || "";
    else if (arg === "--feature") args.feature = argv[++i] || args.feature;
    else if (arg === "--out") args.out = argv[++i] || "";
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node ownership_graph_scaffold.js --input inventory.json --feature <name> [--out ownership.md]");
      process.exit(0);
    }
  }
  return args;
}

function readRows(input) {
  if (!input) return [];
  const buffer = fs.readFileSync(input);
  let raw;
  if ((buffer[0] === 0xff && buffer[1] === 0xfe) || buffer.includes(0)) {
    raw = buffer.toString("utf16le").replace(/^\uFEFF/, "");
  } else {
    raw = buffer.toString("utf8").replace(/^\uFEFF/, "");
  }
  const data = JSON.parse(raw);
  return Array.isArray(data.rows) ? data.rows : [];
}

function groupRows(rows) {
  const result = new Map();
  for (const row of rows) {
    const key = `${row.group || "seed"}|${row.layer || "other"}|${row.file || ""}`;
    if (!result.has(key)) result.set(key, { group: row.group || "seed", layer: row.layer || "other", file: row.file || "", terms: new Set(), lines: [] });
    const item = result.get(key);
    item.terms.add(row.term);
    item.lines.push(row.line);
  }
  return [...result.values()].map((item) => ({ ...item, terms: [...item.terms], lines: item.lines.slice(0, 5) }));
}

function orderFor(item) {
  if (item.group === "seed") return "1-й";
  if (item.group === "owner") return "2-й";
  if (item.group === "recipient") return "3-й";
  if (item.group === "analog") return "аналог";
  if (/ui|tests-fixtures/.test(item.layer)) return "N-й";
  if (/render|serialization|api/.test(item.layer)) return "N-й";
  return "уточнить";
}

function roleFor(item) {
  if (item.group === "seed") return "целевая сущность";
  if (item.group === "owner") return "владелец/контейнер";
  if (item.group === "recipient") return "получатель";
  if (item.group === "analog") return "аналог, не подтверждение цели";
  return item.layer;
}

function esc(value) {
  return String(value ?? "").replace(/\|/g, "\\|");
}

function build(args, rows) {
  const grouped = groupRows(rows);
  const out = [];
  out.push(`# Ownership graph scaffold: ${args.feature}`);
  out.push("");
  out.push("Что показывает: заготовку матрицы порядков владения по результатам поиска. Заполни тип связи и вывод после чтения файлов.");
  out.push("");
  out.push("| Порядок | Роль | Термины | Файл | Строки | Тип связи | Evidence | Вывод |");
  out.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const item of grouped) {
    out.push(`| ${orderFor(item)} | ${roleFor(item)} | ${esc(item.terms.join(", "))} | ${esc(item.file)} | ${esc(item.lines.join(", "))} | уточнить | search hit | уточнить |`);
  }
  out.push("");
  out.push("## Следующий словарь поиска");
  out.push("");
  out.push("| Порядок | Термин | Почему добавить | Статус |");
  out.push("| --- | --- | --- | --- |");
  out.push("| 2-й | ... | найден владелец/контейнер | проверить | ");
  out.push("| 3-й | ... | найден получатель/семейство | проверить | ");
  out.push("| N-й | ... | найден старт сценария или output/persistence path | проверить | ");
  return out.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = build(args, readRows(args.input));
  if (args.out) fs.writeFileSync(args.out, report, "utf8");
  else process.stdout.write(report);
}

main();