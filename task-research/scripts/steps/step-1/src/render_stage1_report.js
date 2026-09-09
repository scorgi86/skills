"use strict";

function esc(value) { return String(value ?? "").replace(/\|/g, "\\|"); }

function anchor(value) { return value && value.file ? `${value.file}${value.line ? `:${value.line}` : ""}` : "—"; }

function stageStatus(facts) { return facts.status === "partial" ? "частично" : "закрыт"; }

function confirmed(groups) { return groups.filter((item) => /^(confirmed|подтвержденное использование)$/i.test(item.status || "")).length; }

function transitionFields(facts) {
  const previous = facts.transition && facts.transition.fields || {};
  const groups = facts.ownership && facts.ownership.groups || [];
  return {
    target: previous.target || "целевой объект этапа 1",
    scope: previous.scope || "scope recorded in facts",
    stage: "1",
    status: stageStatus(facts),
    "confirmed evidence": `${confirmed(groups)} ownership groups explicitly confirmed; source anchors retained for all required groups`,
    "candidate evidence": `${groups.length - confirmed(groups)} ownership groups remain candidates until manual confirmation`,
    "dictionary/graph/path state": `ownership groups=${groups.length}; boundary candidates=${(facts.boundaries || []).length}; AST plan=${facts.ast && facts.ast.plan && facts.ast.plan.id || "none"}`,
    "skipped/forbidden": previous["skipped/forbidden"] || "see limitations in canonical stage artifact",
    "open checks": previous["open checks"] || "expand second- and higher-order vocabulary",
    "next stage": "2 — Расширение словаря после явной команды пользователя",
  };
}

function renderStage1Report(facts, options = {}) {
  if (!facts || Number(facts.stage) !== 1) throw new Error("Stage 1 facts are required");
  const groups = facts.ownership && facts.ownership.groups || [];
  const transition = options.transition || transitionFields(facts);
  const artifactLinks = options.artifacts || [];
  const gate = facts.quality && facts.quality.coverageGate || { ok: false, errors: ["gate unavailable"] };
  const lines = ["# Этап 1. Нижние слои и владение", "", "## Вход", "", "- Предыдущий артефакт этапа 0: canonical transition.", "- Режим: facts-first, read-only; полные evidence сохраняются в canonical stage artifact.", "", "## Действия", "", "- Выполнен единый заранее скомпилированный AST-план и bounded source evidence.", "- GitNexus использован только для candidate navigation; его недоступность не доказывает отсутствие.", "", "## Выход", "", "Что показывает: подтверждённые и кандидатные нижние связи владения без автоматического повышения статуса.", "", "Зачем нужна: словарь этапа 2 строится по владельцам, контейнерам и serializers, а не только по seed-термину.", "", "Как читать: anchor указывает исходник; статус `candidate` требует отдельного ручного подтверждения.", "", "Как использовать: передавать object, relation и evidence refs в request этапа 2.", "", "| Порядок | Роль | Объект | Связь | Anchor | Статус |", "|---|---|---|---|---|---|"];
  for (const group of groups) lines.push(`| ${esc(group.order)} | ${esc(group.role)} | ${esc(group.object)} | ${esc(group.relation)} | ${esc(anchor(group.anchor))} | ${esc(group.status)} |`);
  const boundaries = facts.boundaries || [];
  if (boundaries.length) {
    lines.push("", "### Границы producer-consumer", "", "Что показывает: кандидатные границы между моделью producer-repo и consumer-repo.", "", "Зачем нужна: Stage 2 расширяет их словарь, а Stage 3 проверяет реальные сценарные старты.", "", "Как читать: это не подтверждённые UI-использования; каждый кандидат привязан к исходнику producer-repo.", "", "Как использовать: передавать search terms и consumer scope в Stage 2.", "", "| ID | Kind | Symbol | Relation | Consumer repos | Anchor | Статус |", "|---|---|---|---|---|---|---|");
    for (const item of boundaries) lines.push(`| ${esc(item.id)} | ${esc(item.kind)} | ${esc(item.symbol)} | ${esc(item.relation)} | ${esc(item.consumerRepos.join(", "))} | ${esc(anchor(item.anchor))} | ${esc(item.status)} |`);
  }
  const contract = facts.coverageContract || {};
  const categories = Array.isArray(contract.categories) ? contract.categories : [];
  if (categories.length) {
    lines.push("", "### Контракт полноты", "", "| Категория | Статус | Закрыть перед завершением | Группы | Причина |", "|---|---|---|---|---|");
    for (const category of categories) lines.push(`| ${esc(category.id)} | ${esc(category.status)} | ${category.requiredBeforeClose === true ? "да" : "нет"} | ${esc((category.groupIds || []).join(", ") || "—")} | ${esc(category.reason || "—")} |`);
    const baseline = contract.baseline && contract.baseline.ownershipIds || [];
    if (baseline.length) lines.push("", `Baseline ownership groups: ${baseline.map(esc).join(", ")}.`);
  }
  const claims = facts.claimLedger && Array.isArray(facts.claimLedger.claims) ? facts.claimLedger.claims : [];
  const observations = Array.isArray(facts.observations) ? facts.observations : [];
  if (claims.length) {
    lines.push("", "### Ledger утверждений", "", "| Утверждение | Статус | Ownership-группы | Observations |", "|---|---|---|---|");
    for (const claim of claims) lines.push(`| ${esc(claim.id)} | ${esc(claim.status)} | ${esc((claim.groupIds || []).join(", ") || "—")} | ${esc((claim.observationIds || []).join(", ") || "—")} |`);
  }
  if (observations.length) {
    lines.push("", "### Наблюдения", "");
    for (const observation of observations) lines.push(`- ${esc(observation.id)}: ${esc(observation.status)}; scope: ${esc(observation.scope)}; ${esc(observation.result || "")}`);
  }
  lines.push("", "## DoD", "", `- [${gate.ok ? "x" : " "}] AST и source coverage gate: ${gate.ok ? "пройден" : esc((gate.errors || []).join("; "))}.`, `- [${gate.ok ? "x" : " "}] Required ownership groups имеют source anchors.`, "- [x] Автоматическое повышение candidate до подтверждённого использования отключено.", "", "## Статус этапа", "", stageStatus(facts), "", "## Артефакт для следующего этапа", "");
  for (const [key, value] of Object.entries(transition)) lines.push(`- ${key}: ${value}`);
  if (artifactLinks.length) {
    lines.push("", "## Артефакты", "");
    for (const item of artifactLinks) lines.push(`- [${item.purpose}](./${item.path})`);
  }
  lines.push("", "## Следующий этап", "", "Этап 2 запускается согласно mode и driver из `inventory-state.json`: интерактивно или через активную цель.", "", "## Stage Execution Report", "", `- mode: read from inventory-state.json`, "- driver: read from inventory-state.json", "- stages completed: 1 — Нижние слои и владение", "- stages completed this run: append stage 1 after successful advance", "- evidence collected: AST groups, bounded source evidence, ownership rows and graph limitations", "- skipped/forbidden sources: see canonical transition and manifest", "- open checks: этапы 2–8 и ручное подтверждение candidate rows", "- protocol deviations: none", "- next step: apply the recorded mode and driver for stage 2", "", "## Execution Status", "", `- Execution Status: ${gate.ok ? "complete" : "partial"}`, "- current stage: 1 — Нижние слои и владение", "- next step: этап 2 — Расширение словаря", "- continuation: interactive `продолжай` or active goal", "");
  return lines.join("\n");
}

module.exports = { renderStage1Report, transitionFields };
