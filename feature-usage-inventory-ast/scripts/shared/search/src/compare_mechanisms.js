"use strict";

const fs = require("fs");

const path = require("path");

const LAYERS = ["unclassified"];

const SKIP_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".zip", ".rar", ".7z", ".pack"]);

function split(value) { return String(value || "").split(",").map((x) => x.trim()).filter(Boolean); }

function files(scope, seen = new Set()) {
  const out = [];
  let stat; try { stat = fs.statSync(scope); } catch { return out; }
  let real; try { real = fs.realpathSync(scope); } catch { real = path.resolve(scope); }
  if (stat.isDirectory()) { if (seen.has(real)) return out; seen.add(real); }
  if (stat.isFile()) return [scope];
  if (!stat.isDirectory()) return out;
  let entries; try { entries = fs.readdirSync(scope, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const full = path.join(scope, entry.name);
    if (entry.isDirectory() || entry.isSymbolicLink()) out.push(...files(full, seen));
    else if (entry.isFile() && !SKIP_EXT.has(path.extname(entry.name).toLowerCase())) out.push(full);
  }
  return out;
}

function binary(buf) { for (let i = 0; i < Math.min(buf.length, 4096); i += 1) if (buf[i] === 0) return true; return false; }

function classify() { return LAYERS; }

function search(terms, scopes) {
  const all = scopes.flatMap((scope) => files(scope));
  const rows = [];
  for (const file of all) {
    let buf; try { buf = fs.readFileSync(file); } catch { continue; }
    if (binary(buf)) continue;
    const lines = buf.toString("utf8").split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const lower = lines[i].toLowerCase();
      for (const term of terms) {
        if (!lower.includes(term.toLowerCase())) continue;
        rows.push({ term, file, line: i + 1, text: lines[i].trim(), layers: classify(`${file} ${lines[i]}`) });
      }
    }
  }
  return rows;
}

function byLayer(rows) { const m = new Map(); for (const r of rows) for (const l of r.layers) { if (!m.has(l)) m.set(l, []); m.get(l).push(r); } return m; }

function sample(rows) { return rows.slice(0, 3).map((r) => `${r.file}:${r.line}`).join("; "); }

function status(t, a) { if (t.length && a.length) return "оба пути найдены"; if (t.length) return "только целевая сущность"; if (a.length) return "вероятный пробел реализации"; return "проверено, использования нет"; }

function toMarkdown(result) {
  const out = ["# Mechanism comparison", "", `Target terms: ${result.targetTerms.map((x) => `\`${x}\``).join(", ")}`, `Analog terms: ${result.analogTerms.map((x) => `\`${x}\``).join(", ")}`, "", "| Слой | Целевая сущность | Аналог | Статус | Что проверить дальше |", "| --- | --- | --- | --- | --- |"];
  for (const row of result.matrix) out.push(`| ${row.layer} | ${row.targetEvidence || "-"} | ${row.analogEvidence || "-"} | ${row.status} | ${row.next} |`);
  return out.join("\n");
}

module.exports = { split, search, byLayer, LAYERS, status, sample, toMarkdown };

function compareMechanisms(args) {
    const targetRows = search(args.target, args.scopes);
    const analogRows = search(args.analog, args.scopes);
    const targetBy = byLayer(targetRows), analogBy = byLayer(analogRows);
    const layers = [
        ...new Set([
            ...LAYERS,
            ...targetBy.keys(),
            ...analogBy.keys()
        ])
    ];
    const matrix = layers.map((layer)=>{
        const t = targetBy.get(layer) || [], a = analogBy.get(layer) || [], s = status(t, a);
        return {
            layer,
            targetEvidence: sample(t),
            analogEvidence: sample(a),
            status: s,
            next: s === "вероятный пробел реализации" ? "искать симметричный путь цели или подтвердить, что он не нужен" : "уточнить критический путь"
        };
    });
    const result = {
        targetTerms: args.target,
        analogTerms: args.analog,
        scopes: args.scopes,
        matrix,
        targetRows,
        analogRows
    };
    return result;
}
module.exports.compareMechanisms = compareMechanisms;
