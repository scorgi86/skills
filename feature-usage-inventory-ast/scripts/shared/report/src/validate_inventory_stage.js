"use strict";

const { findInternalReportIdentifiers } = require('../../output/src/human_report_codec.js');

const REQUIRED_LABELS = [
  'Вход',
  'Действия',
  'Выход',
  'DoD',
  'Статус этапа',
  'Артефакт для следующего этапа',
  'Следующий этап',
];

const ALLOWED_STATUSES = new Set(['закрыт', 'частично', 'не закрыт']);

const WEAK_PLACEHOLDERS = /(?:^|\s)(?:todo|tbd|n\/a|\.\.\.|заполнить|позже|не задано)(?:\s|$)/i;

const REQUIRED_TRANSITION_FIELDS = [
  ['target', /^(?:[-*]\s*)?(?:target|цель|целевая сущность)\s*:/im],
  ['scope', /^(?:[-*]\s*)?(?:scope|область|границы)\s*:/im],
  ['stage', /^(?:[-*]\s*)?(?:stage|этап)\s*:/im],
  ['status', /^(?:[-*]\s*)?(?:status|статус)\s*:/im],
  ['confirmed evidence', /^(?:[-*]\s*)?(?:confirmed evidence|подтвержденные доказательства|подтвержденное evidence)\s*:/im],
  ['candidate evidence', /^(?:[-*]\s*)?(?:candidate evidence|кандидатные доказательства|кандидатное evidence)\s*:/im],
  ['dictionary/graph/path state', /^(?:[-*]\s*)?(?:dictionary\/graph\/path state|состояние словаря\/графа\/путей|накопленное состояние)\s*:/im],
  ['skipped/forbidden', /^(?:[-*]\s*)?(?:skipped\/forbidden|пропущено\/запрещено|исключения)\s*:/im],
  ['open checks', /^(?:[-*]\s*)?(?:open checks|открытые проверки|незакрытые проверки)\s*:/im],
  ['next stage', /^(?:[-*]\s*)?(?:next stage|следующий этап)\s*:/im],
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalize(value) {
  return value.replace(/\r\n/g, '\n');
}

function hasStageHeading(text, stage) {
  return new RegExp(`^#{1,6}\\s*Этап\\s+${stage}(?:\\b|\\s|[-:])`, 'im').test(text);
}

function hasLaterStageHeading(text, stage) {
  for (let next = stage + 1; next <= 8; next += 1) {
    if (hasStageHeading(text, next)) return next;
  }
  return null;
}

function labelPresent(text, label) {
  return new RegExp(`^#{1,6}\\s*${escapeRegExp(label)}\\s*$`, 'im').test(text);
}

function extractBlock(text, label) {
  const labelRe = new RegExp(`^#{1,6}\\s*${escapeRegExp(label)}\\s*$`, 'im');
  const match = labelRe.exec(text);
  if (!match) return '';
  const after = text.slice(match.index + match[0].length);
  const labels = REQUIRED_LABELS.map(escapeRegExp).join('|');
  const nextRe = new RegExp(`^#{1,6}\\s*(?:${labels})\\s*$`, 'im');
  const next = nextRe.exec(after);
  return (next ? after.slice(0, next.index) : after).trim();
}

function hasSubstantialContent(block) {
  const compact = block.replace(/[-*\[\]xX\s.]/g, '');
  return compact.length >= 8 && !WEAK_PLACEHOLDERS.test(block.trim());
}

function validate(text, stage) {
  const errors = [];
  const warnings = [];
  const normalized = normalize(text);

  if (!Number.isInteger(stage) || stage < 0 || stage > 8) {
    errors.push('Stage must be an integer from 0 to 8.');
    return { ok: false, errors, warnings };
  }
  if (stage === 2) {
    const internalIdentifiers = findInternalReportIdentifiers(normalized);
    if (internalIdentifiers.length) errors.push(`Stage 2 human-readable report contains internal identifiers: ${internalIdentifiers.join(', ')}.`);
  }
  if (!hasStageHeading(normalized, stage)) errors.push(`Missing current stage heading: Этап ${stage}.`);

  const laterStage = hasLaterStageHeading(normalized, stage);
  if (laterStage !== null) {
    errors.push(`Artifact includes later stage heading Этап ${laterStage}; stage-gated mode allows only one current stage per artifact.`);
  }

  for (const label of REQUIRED_LABELS) {
    if (!labelPresent(normalized, label)) errors.push(`Missing required block: ${label}.`);
  }

  const blocks = Object.fromEntries(REQUIRED_LABELS.map((label) => [label, extractBlock(normalized, label)]));
  for (const [label, block] of Object.entries(blocks)) {
    if (label !== 'Статус этапа' && block && !hasSubstantialContent(block)) {
      warnings.push(`Block looks weak or placeholder-like: ${label}.`);
    }
  }

  const statusText = (blocks['Статус этапа'] || '').toLowerCase();
  const status = [...ALLOWED_STATUSES].find((candidate) => statusText.includes(candidate));
  if (!status) errors.push('Статус этапа must contain one of: закрыт, частично, не закрыт.');

  const dod = blocks.DoD || '';
  if (!/- \[[ xX]\]/.test(dod)) warnings.push('DoD block should use checklist items: - [x] / - [ ].');
  if (status === 'закрыт' && /- \[ \]/.test(dod)) errors.push('Stage status is закрыт, but DoD contains unchecked items.');
  if (status && status !== 'закрыт' && !/(?:что осталось|осталось|блокер|причин|нельзя|не закрыт|частично)/i.test(normalized)) {
    errors.push('Non-closed stage must explicitly explain remaining work or blockers.');
  }

  if (stage > 0) {
    const input = blocks['Вход'] || '';
    const mentionsPrevious = new RegExp(`(?:этап(?:а)?\\s+${stage - 1}|предыдущ(?:ий|его)\\s+этап|артефакт(?:а)?\\s+предыдущ)`, 'i').test(input);
    const hasPathLikeReference = /(?:[A-Z]:\\|\/|\.md\b|\[[^\]]+\]\([^\)]+\))/i.test(input);
    if (!mentionsPrevious && !hasPathLikeReference) {
      warnings.push(`Stage ${stage} input should reference the previous stage artifact or Этап ${stage - 1}.`);
    }
  }

  const next = blocks['Следующий этап'] || '';
  if (!/продолжай|следующий этап|останов|режим|mode|continue|продолж/i.test(next)) {
    errors.push('Следующий этап must identify the next stage and either the execution-mode decision or a resume command.');
  }

  const artifact = blocks['Артефакт для следующего этапа'] || '';
  if (!hasSubstantialContent(artifact)) errors.push('Артефакт для следующего этапа must contain a concrete file/link/data block, not a placeholder.');
  for (const [field, pattern] of REQUIRED_TRANSITION_FIELDS) {
    if (artifact && !pattern.test(artifact)) {
      errors.push(`Transition artifact is missing required field: ${field}.`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

module.exports = { validate };
