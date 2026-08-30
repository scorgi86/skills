'use strict';

const nativePath = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { issue } = require('./result');

const REQUIREMENT_STATUSES = new Set([
  'реализовано', 'частично реализовано', 'не реализовано',
  'реализовано с отклонением', 'невозможно подтвердить', 'не применимо'
]);
const EVIDENCE_SUFFICIENCY = new Set(['достаточно', 'частично', 'недостаточно']);
const PRIORITIES = new Set(['P0', 'P1', 'P2', 'P3']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value, path, errors) {
  if (typeof value !== 'string' || value.length === 0) {
    errors.push(issue('invalid_string', path, 'Expected a non-empty string'));
    return false;
  }
  return true;
}

function requiredArray(value, path, errors) {
  if (!Array.isArray(value)) {
    errors.push(issue('invalid_array', path, 'Expected an array'));
    return false;
  }
  return true;
}

function requiredObject(value, path, errors) {
  if (!isObject(value)) {
    errors.push(issue('invalid_object', path, 'Expected an object'));
    return false;
  }
  return true;
}

function validateOid(value, path, errors) {
  if (!requiredString(value, path, errors)) return false;
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value)) {
    errors.push(issue('invalid_oid', path, 'Expected a full lowercase 40- or 64-character hexadecimal OID'));
    return false;
  }
  return true;
}

function validateGitPath(value, path, errors) {
  if (!requiredString(value, path, errors)) return false;
  if (value.includes('\0') || value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')) {
    errors.push(issue('invalid_path', path, 'Expected a relative Git path'));
    return false;
  }
  const parts = value.split('/');
  if (parts.some((part) => part === '.' || part === '..' || part === '')) {
    errors.push(issue('invalid_path', path, 'Git path contains an empty, dot, or traversal segment'));
    return false;
  }
  return true;
}

function addUnique(index, value, path, kind, errors) {
  if (!requiredString(value, path, errors)) return;
  if (index.has(value)) errors.push(issue('duplicate_identifier', path, `Duplicate ${kind}: ${value}`));
  else index.add(value);
}

function validateCodeRef(ref, path, repositoryIds, errors) {
  if (!requiredObject(ref, path, errors)) return;
  validateRepositoryRef(ref, path, repositoryIds, errors);
  validateGitPath(ref.path, `${path}.path`, errors);
  if (ref.start_line !== undefined && (!Number.isInteger(ref.start_line) || ref.start_line < 1)) {
    errors.push(issue('invalid_line', `${path}.start_line`, 'start_line must be a positive integer'));
  }
  if (ref.end_line !== undefined) {
    if (ref.start_line === undefined) errors.push(issue('invalid_line', `${path}.end_line`, 'end_line requires start_line'));
    if (!Number.isInteger(ref.end_line) || ref.end_line < 1) errors.push(issue('invalid_line', `${path}.end_line`, 'end_line must be a positive integer'));
    if (Number.isInteger(ref.start_line) && Number.isInteger(ref.end_line) && ref.start_line > ref.end_line) {
      errors.push(issue('invalid_line_range', path, 'start_line must not exceed end_line'));
    }
  }
  if (ref.symbol !== undefined && typeof ref.symbol !== 'string') errors.push(issue('invalid_string', `${path}.symbol`, 'symbol must be a string'));
}

function validateRepositoryRef(ref, path, repositoryIds, errors) {
  if (!requiredString(ref.repository_id, `${path}.repository_id`, errors)) return;
  if (!repositoryIds.has(ref.repository_id)) {
    errors.push(issue('unknown_repository', `${path}.repository_id`, `Repository is not declared: ${ref.repository_id}`));
  }
}

function validateSourceRef(ref, path, repositoryIds, errors) {
  if (!requiredObject(ref, path, errors) || !requiredString(ref.kind, `${path}.kind`, errors)) return;
  if (ref.kind === 'repository') validateCodeRef(ref.code_ref, `${path}.code_ref`, repositoryIds, errors);
  else if (ref.kind === 'attachment' || ref.kind === 'task') requiredString(ref.source_id, `${path}.source_id`, errors);
  else if (ref.kind === 'url') requiredString(ref.url, `${path}.url`, errors);
  else errors.push(issue('invalid_enum', `${path}.kind`, `Unsupported source kind: ${ref.kind}`));
  if (ref.section !== undefined && typeof ref.section !== 'string') errors.push(issue('invalid_string', `${path}.section`, 'section must be a string'));
}

function validateScopeRef(ref, path, repositoryIds, errors, kind, idIndex) {
  if (!requiredObject(ref, path, errors)) return;
  addUnique(idIndex, ref.id, `${path}.id`, `${kind} scope id`, errors);
  validateRepositoryRef(ref, path, repositoryIds, errors);
  if (ref.path !== undefined) validateGitPath(ref.path, `${path}.path`, errors);
  if (ref.path_prefix !== undefined) validateGitPath(ref.path_prefix, `${path}.path_prefix`, errors);
  const hasScope = ['path', 'path_prefix', 'component'].some((field) => typeof ref[field] === 'string' && ref[field].length > 0)
    || (Array.isArray(ref.symbols) && ref.symbols.length > 0);
  if (!hasScope) errors.push(issue('empty_scope', path, `${kind} scope must identify a path, component, or symbols`));
  if (ref.symbols !== undefined && (!Array.isArray(ref.symbols) || ref.symbols.some((value) => typeof value !== 'string' || !value))) {
    errors.push(issue('invalid_array', `${path}.symbols`, 'symbols must contain non-empty strings'));
  }
  if (ref.queries !== undefined && (!Array.isArray(ref.queries) || ref.queries.some((value) => typeof value !== 'string'))) {
    errors.push(issue('invalid_array', `${path}.queries`, 'queries must contain strings'));
  }
}

function validateSnapshotRepository(repository, path, errors, repositoryIds) {
  if (!requiredObject(repository, path, errors)) return;
  if (repositoryIds) addUnique(repositoryIds, repository.repository_id, `${path}.repository_id`, 'repository id', errors);
  else requiredString(repository.repository_id, `${path}.repository_id`, errors);
  requiredString(repository.path, `${path}.path`, errors);
  requiredString(repository.canonical_remote, `${path}.canonical_remote`, errors);
  for (const field of ['base_sha', 'head_sha', 'merge_base_sha', 'diff_from_sha', 'diff_to_sha']) {
    validateOid(repository[field], `${path}.${field}`, errors);
  }
  if (requiredString(repository.diff_semantics, `${path}.diff_semantics`, errors) && repository.diff_semantics === 'merge-base-to-head') {
    if (repository.diff_from_sha !== repository.merge_base_sha) errors.push(issue('boundary_mismatch', `${path}.diff_from_sha`, 'diff_from_sha must equal merge_base_sha'));
    if (repository.diff_to_sha !== repository.head_sha) errors.push(issue('boundary_mismatch', `${path}.diff_to_sha`, 'diff_to_sha must equal head_sha'));
  }
}

function validateSnapshotInput(input) {
  const errors = [];
  if (!requiredObject(input, '', errors)) return { errors };
  requiredString(input.repository_id, 'repository_id', errors);
  if (requiredString(input.repository_path, 'repository_path', errors) && !nativePath.isAbsolute(input.repository_path)) {
    errors.push(issue('invalid_repository_path', 'repository_path', 'repository_path must be an absolute native path'));
  }
  for (const field of ['base_sha', 'head_sha', 'merge_base_sha', 'diff_from_sha', 'diff_to_sha']) validateOid(input[field], field, errors);
  if (requiredString(input.diff_semantics, 'diff_semantics', errors)) {
    if (input.diff_semantics !== 'merge-base-to-head') errors.push(issue('invalid_enum', 'diff_semantics', 'MVP supports only merge-base-to-head'));
    else {
      if (input.diff_from_sha !== input.merge_base_sha) errors.push(issue('boundary_mismatch', 'diff_from_sha', 'diff_from_sha must equal merge_base_sha'));
      if (input.diff_to_sha !== input.head_sha) errors.push(issue('boundary_mismatch', 'diff_to_sha', 'diff_to_sha must equal head_sha'));
    }
  }
  return { errors };
}

function validatePacket(packet) {
  const errors = [];
  if (!requiredObject(packet, '', errors)) return { errors };
  requiredString(packet.assignment_id, 'assignment_id', errors);
  if (packet.materialized_diff !== undefined && packet.materialized_diff !== null) {
    errors.push(issue('unsupported_materialized_diff', 'materialized_diff', 'MVP fast path does not support materialized_diff'));
  }

  const repositoryIds = new Set();
  if (requiredArray(packet.repositories, 'repositories', errors)) {
    if (packet.repositories.length === 0) errors.push(issue('empty_array', 'repositories', 'At least one repository is required'));
    packet.repositories.forEach((repository, index) => validateSnapshotRepository(repository, `repositories.${index}`, errors, repositoryIds));
  }

  const requirementIds = new Set();
  if (requiredArray(packet.requirements, 'requirements', errors)) {
    if (packet.requirements.length === 0) errors.push(issue('empty_array', 'requirements', 'At least one requirement is required'));
    packet.requirements.forEach((requirement, index) => {
      const path = `requirements.${index}`;
      if (!requiredObject(requirement, path, errors)) return;
      addUnique(requirementIds, requirement.id, `${path}.id`, 'requirement id', errors);
      requiredString(requirement.criterion, `${path}.criterion`, errors);
      requiredArray(requirement.constraints, `${path}.constraints`, errors);
      validateSourceRef(requirement.source_ref, `${path}.source_ref`, repositoryIds, errors);
    });
  }

  const changedFileKeys = new Set();
  for (const field of ['changed_files', 'inspection_scope', 'absence_search_scope']) requiredArray(packet[field], field, errors);
  if (Array.isArray(packet.changed_files)) packet.changed_files.forEach((ref, index) => {
    const path = `changed_files.${index}`;
    if (!requiredObject(ref, path, errors)) return;
    validateRepositoryRef(ref, path, repositoryIds, errors);
    if (validateGitPath(ref.path, `${path}.path`, errors) && typeof ref.repository_id === 'string') {
      const key = `${ref.repository_id}\0${ref.path}`;
      if (changedFileKeys.has(key)) errors.push(issue('duplicate_reference', path, 'Duplicate file_ref'));
      changedFileKeys.add(key);
    }
  });

  const inspectionIds = new Set();
  const searchIds = new Set();
  if (Array.isArray(packet.inspection_scope)) packet.inspection_scope.forEach((ref, index) => validateScopeRef(ref, `inspection_scope.${index}`, repositoryIds, errors, 'inspection', inspectionIds));
  if (Array.isArray(packet.absence_search_scope)) packet.absence_search_scope.forEach((ref, index) => validateScopeRef(ref, `absence_search_scope.${index}`, repositoryIds, errors, 'search', searchIds));
  if (Array.isArray(packet.changed_files) && Array.isArray(packet.inspection_scope) && Array.isArray(packet.absence_search_scope)
      && packet.changed_files.length + packet.inspection_scope.length + packet.absence_search_scope.length === 0) {
    errors.push(issue('empty_assignment_scope', '', 'At least one assignment scope must be non-empty'));
  }
  requiredArray(packet.semantic_scope, 'semantic_scope', errors);
  requiredArray(packet.hard_exclusions, 'hard_exclusions', errors);
  requiredObject(packet.permissions, 'permissions', errors);
  const inspectionById = new Map(Array.isArray(packet.inspection_scope)
    ? packet.inspection_scope.filter((value) => isObject(value) && typeof value.id === 'string').map((value) => [value.id, value])
    : []);
  const searchById = new Map(Array.isArray(packet.absence_search_scope)
    ? packet.absence_search_scope.filter((value) => isObject(value) && typeof value.id === 'string').map((value) => [value.id, value])
    : []);
  return { errors, repositoryIds, requirementIds, inspectionIds, searchIds, inspectionById, searchById };
}

function validateRequirementIds(values, path, requirementIds, errors, allowEmpty = true) {
  if (!requiredArray(values, path, errors)) return;
  if (!allowEmpty && values.length === 0) errors.push(issue('empty_array', path, 'At least one requirement id is required'));
  values.forEach((value, index) => {
    if (!requiredString(value, `${path}.${index}`, errors)) return;
    if (!requirementIds.has(value)) errors.push(issue('unknown_requirement', `${path}.${index}`, `Requirement is not declared: ${value}`));
  });
}

function validateScopeWrapper(wrapper, path, indexes, errors) {
  if (!requiredObject(wrapper, path, errors) || !requiredString(wrapper.kind, `${path}.kind`, errors)) return;
  const value = wrapper.value;
  if (wrapper.kind === 'file_ref') {
    if (requiredObject(value, `${path}.value`, errors)) {
      validateRepositoryRef(value, `${path}.value`, indexes.repositoryIds, errors);
      validateGitPath(value.path, `${path}.value.path`, errors);
    }
  } else if (wrapper.kind === 'code_ref') validateCodeRef(value, `${path}.value`, indexes.repositoryIds, errors);
  else if (wrapper.kind === 'source_ref') validateSourceRef(value, `${path}.value`, indexes.repositoryIds, errors);
  else if (wrapper.kind === 'inspection_scope_ref' || wrapper.kind === 'search_scope_ref') {
    if (!requiredObject(value, `${path}.value`, errors)) return;
    const index = wrapper.kind === 'inspection_scope_ref' ? indexes.inspectionById : indexes.searchById;
    if (!requiredString(value.id, `${path}.value.id`, errors)) return;
    const declared = index.get(value.id);
    if (!declared) errors.push(issue('unknown_scope', `${path}.value.id`, `Scope is not declared: ${value.id}`));
    else if (!isDeepStrictEqual(value, declared)) errors.push(issue('scope_mismatch', `${path}.value`, `Scope ref does not match packet declaration: ${value.id}`));
  } else errors.push(issue('invalid_enum', `${path}.kind`, `Unsupported scope ref kind: ${wrapper.kind}`));
}

function validateScopeWrapperArray(value, path, indexes, errors) {
  if (!requiredArray(value, path, errors)) return;
  value.forEach((wrapper, index) => validateScopeWrapper(wrapper, `${path}.${index}`, indexes, errors));
}

function validateExpectedOwner(owner, path, repositoryIds, errors) {
  if (!requiredObject(owner, path, errors) || !requiredString(owner.kind, `${path}.kind`, errors)) return;
  if (owner.kind === 'repository') validateRepositoryRef(owner, path, repositoryIds, errors);
  else if (owner.kind !== 'external' && owner.kind !== 'unknown') errors.push(issue('invalid_enum', `${path}.kind`, `Unsupported owner kind: ${owner.kind}`));
}

function compareSnapshotEcho(packet, handoff, errors) {
  if (!requiredObject(handoff.snapshot_echo, 'snapshot_echo', errors)) return;
  if (!requiredArray(handoff.snapshot_echo.repositories, 'snapshot_echo.repositories', errors)) return;
  const packetById = new Map(packet.repositories.map((repository) => [repository.repository_id, repository]));
  const seen = new Set();
  handoff.snapshot_echo.repositories.forEach((echo, index) => {
    const path = `snapshot_echo.repositories.${index}`;
    if (!requiredObject(echo, path, errors) || !requiredString(echo.repository_id, `${path}.repository_id`, errors)) return;
    if (seen.has(echo.repository_id)) errors.push(issue('duplicate_identifier', `${path}.repository_id`, 'Duplicate snapshot repository'));
    seen.add(echo.repository_id);
    const expected = packetById.get(echo.repository_id);
    if (!expected) {
      errors.push(issue('unknown_repository', `${path}.repository_id`, `Repository is not declared: ${echo.repository_id}`));
      return;
    }
    for (const field of ['canonical_remote', 'base_sha', 'head_sha', 'merge_base_sha', 'diff_from_sha', 'diff_to_sha', 'diff_semantics']) {
      if (echo[field] !== expected[field]) errors.push(issue('snapshot_mismatch', `${path}.${field}`, `${field} does not match packet`));
    }
    if (echo.materialized_diff !== undefined && echo.materialized_diff !== null) errors.push(issue('unsupported_materialized_diff', `${path}.materialized_diff`, 'MVP fast path does not support materialized_diff'));
  });
  for (const repositoryId of packetById.keys()) {
    if (!seen.has(repositoryId)) errors.push(issue('missing_snapshot_repository', 'snapshot_echo.repositories', `Missing snapshot repository: ${repositoryId}`));
  }
}

function validateFinding(finding, path, indexes, localIds, errors) {
  if (!requiredObject(finding, path, errors)) return;
  addUnique(localIds, finding.local_id, `${path}.local_id`, 'finding local_id', errors);
  if (!PRIORITIES.has(finding.priority)) errors.push(issue('invalid_enum', `${path}.priority`, 'Unsupported finding priority'));
  validateRequirementIds(finding.requirement_ids, `${path}.requirement_ids`, indexes.requirementIds, errors, finding.kind === 'implementation_gap');
  if (finding.kind === 'defect') {
    requiredArray(finding.contract_refs, `${path}.contract_refs`, errors);
    if (Array.isArray(finding.requirement_ids) && Array.isArray(finding.contract_refs)
        && finding.requirement_ids.length === 0 && finding.contract_refs.length === 0) {
      errors.push(issue('unlinked_finding', path, 'Defect must reference a requirement or contract'));
    }
    validateCodeRef(finding.location, `${path}.location`, indexes.repositoryIds, errors);
    if (requiredArray(finding.evidence_refs, `${path}.evidence_refs`, errors)) {
      if (finding.evidence_refs.length === 0) errors.push(issue('empty_array', `${path}.evidence_refs`, 'Defect requires evidence refs'));
      finding.evidence_refs.forEach((ref, index) => validateCodeRef(ref, `${path}.evidence_refs.${index}`, indexes.repositoryIds, errors));
    }
    for (const field of ['reachable_scenario', 'impact', 'evidence']) requiredString(finding[field], `${path}.${field}`, errors);
  } else if (finding.kind === 'implementation_gap') {
    if (requiredArray(finding.search_scope_refs, `${path}.search_scope_refs`, errors)) {
      if (finding.search_scope_refs.length === 0) errors.push(issue('empty_array', `${path}.search_scope_refs`, 'Implementation gap requires a search scope'));
      finding.search_scope_refs.forEach((id, index) => {
        if (!indexes.searchIds.has(id)) errors.push(issue('unknown_scope', `${path}.search_scope_refs.${index}`, `Search scope is not declared: ${id}`));
      });
    }
    if (requiredArray(finding.evidence_refs, `${path}.evidence_refs`, errors)) finding.evidence_refs.forEach((ref, index) => validateCodeRef(ref, `${path}.evidence_refs.${index}`, indexes.repositoryIds, errors));
    requiredString(finding.absence_evidence, `${path}.absence_evidence`, errors);
    validateExpectedOwner(finding.expected_owner, `${path}.expected_owner`, indexes.repositoryIds, errors);
    requiredString(finding.impact, `${path}.impact`, errors);
  } else errors.push(issue('invalid_enum', `${path}.kind`, 'Finding kind must be defect or implementation_gap'));
}

function validateHandoff(input) {
  const errors = [];
  if (!requiredObject(input, '', errors)) return { errors };
  const packet = input.packet;
  const handoff = input.handoff;
  const packetValidation = validatePacket(packet);
  errors.push(...packetValidation.errors.map((entry) => ({ ...entry, path: entry.path ? `packet.${entry.path}` : 'packet' })));
  if (!requiredObject(handoff, 'handoff', errors) || packetValidation.errors.length) return { errors };
  const prefix = (path) => `handoff.${path}`;
  if (handoff.assignment_id !== packet.assignment_id) errors.push(issue('assignment_mismatch', prefix('assignment_id'), 'assignment_id does not match packet'));
  if (!['passed', 'failed', 'blocked'].includes(handoff.scope_status)) errors.push(issue('invalid_enum', prefix('scope_status'), 'Unsupported scope_status'));
  for (const field of ['verdict', 'global_verdict', 'final_verdict']) {
    if (Object.hasOwn(handoff, field)) errors.push(issue('global_verdict_forbidden', prefix(field), `${field} is forbidden in delegated handoff`));
  }
  compareSnapshotEcho(packet, handoff, errors);

  const indexes = packetValidation;
  const statusById = new Map();
  if (requiredArray(handoff.requirement_statuses, prefix('requirement_statuses'), errors)) handoff.requirement_statuses.forEach((status, index) => {
    const path = prefix(`requirement_statuses.${index}`);
    if (!requiredObject(status, path, errors) || !requiredString(status.id, `${path}.id`, errors)) return;
    if (!indexes.requirementIds.has(status.id)) errors.push(issue('unknown_requirement', `${path}.id`, `Requirement is not declared: ${status.id}`));
    if (statusById.has(status.id)) errors.push(issue('duplicate_identifier', `${path}.id`, `Duplicate requirement status: ${status.id}`));
    statusById.set(status.id, status);
    if (!REQUIREMENT_STATUSES.has(status.status)) errors.push(issue('invalid_enum', `${path}.status`, 'Unsupported requirement status'));
    if (!EVIDENCE_SUFFICIENCY.has(status.evidence_sufficiency)) errors.push(issue('invalid_enum', `${path}.evidence_sufficiency`, 'Unsupported evidence sufficiency'));
    if (requiredArray(status.evidence_refs, `${path}.evidence_refs`, errors)) status.evidence_refs.forEach((ref, refIndex) => validateCodeRef(ref, `${path}.evidence_refs.${refIndex}`, indexes.repositoryIds, errors));
    if (requiredArray(status.search_scope_refs, `${path}.search_scope_refs`, errors)) status.search_scope_refs.forEach((id, refIndex) => {
      if (!indexes.searchIds.has(id)) errors.push(issue('unknown_scope', `${path}.search_scope_refs.${refIndex}`, `Search scope is not declared: ${id}`));
    });
    requiredString(status.evidence, `${path}.evidence`, errors);
  });
  for (const id of indexes.requirementIds) if (!statusById.has(id)) errors.push(issue('missing_requirement_status', prefix('requirement_statuses'), `Missing requirement status: ${id}`));

  const localIds = new Set();
  if (requiredArray(handoff.findings, prefix('findings'), errors)) handoff.findings.forEach((finding, index) => validateFinding(finding, prefix(`findings.${index}`), indexes, localIds, errors));

  const simpleArrays = ['reviewed_files', 'discovered_consumers', 'scope_expansions', 'scope_requests', 'unresolved', 'verification', 'limitations'];
  for (const field of simpleArrays) requiredArray(handoff[field], prefix(field), errors);
  if (Array.isArray(handoff.reviewed_files)) handoff.reviewed_files.forEach((item, index) => {
    const path = prefix(`reviewed_files.${index}`);
    if (!requiredObject(item, path, errors)) return;
    if (requiredObject(item.file_ref, `${path}.file_ref`, errors)) {
      validateRepositoryRef(item.file_ref, `${path}.file_ref`, indexes.repositoryIds, errors);
      validateGitPath(item.file_ref.path, `${path}.file_ref.path`, errors);
    }
    validateRequirementIds(item.requirement_ids, `${path}.requirement_ids`, indexes.requirementIds, errors);
    requiredString(item.summary, `${path}.summary`, errors);
  });
  if (Array.isArray(handoff.discovered_consumers)) handoff.discovered_consumers.forEach((item, index) => {
    const path = prefix(`discovered_consumers.${index}`);
    if (!requiredObject(item, path, errors)) return;
    validateCodeRef(item.code_ref, `${path}.code_ref`, indexes.repositoryIds, errors);
    validateRequirementIds(item.requirement_ids, `${path}.requirement_ids`, indexes.requirementIds, errors);
    requiredString(item.relevance, `${path}.relevance`, errors);
  });
  if (Array.isArray(handoff.scope_expansions)) handoff.scope_expansions.forEach((item, index) => {
    const path = prefix(`scope_expansions.${index}`);
    if (!requiredObject(item, path, errors)) return;
    validateScopeWrapper(item.added_scope, `${path}.added_scope`, indexes, errors);
    validateRequirementIds(item.requirement_ids, `${path}.requirement_ids`, indexes.requirementIds, errors, false);
    requiredString(item.reason, `${path}.reason`, errors);
  });
  if (Array.isArray(handoff.scope_requests)) handoff.scope_requests.forEach((item, index) => {
    const path = prefix(`scope_requests.${index}`);
    if (!requiredObject(item, path, errors)) return;
    validateRequirementIds(item.requirement_ids, `${path}.requirement_ids`, indexes.requirementIds, errors, false);
    requiredString(item.reason, `${path}.reason`, errors);
    const ref = item.requested_scope_ref;
    if (!requiredObject(ref, `${path}.requested_scope_ref`, errors)) return;
    requiredString(ref.requested_repository_id, `${path}.requested_scope_ref.requested_repository_id`, errors);
    if (ref.canonical_remote !== undefined) requiredString(ref.canonical_remote, `${path}.requested_scope_ref.canonical_remote`, errors);
    if (typeof ref.whole_repository !== 'boolean') errors.push(issue('invalid_boolean', `${path}.requested_scope_ref.whole_repository`, 'whole_repository must be boolean'));
    for (const field of ['path_prefixes', 'components', 'symbols']) {
      if (ref[field] !== undefined) {
        if (!Array.isArray(ref[field]) || ref[field].some((value) => typeof value !== 'string' || value.length === 0)) {
          errors.push(issue('invalid_array', `${path}.requested_scope_ref.${field}`, `${field} must contain non-empty strings`));
        } else if (field === 'path_prefixes') {
          ref[field].forEach((value, valueIndex) => validateGitPath(value, `${path}.requested_scope_ref.${field}.${valueIndex}`, errors));
        }
      }
    }
    if (ref.snapshot !== undefined) {
      if (requiredObject(ref.snapshot, `${path}.requested_scope_ref.snapshot`, errors)) {
        const snapshotFields = ['base_sha', 'head_sha', 'merge_base_sha', 'diff_from_sha', 'diff_to_sha'];
        const present = snapshotFields.filter((field) => ref.snapshot[field] !== undefined);
        if (present.length === 0) errors.push(issue('invalid_snapshot', `${path}.requested_scope_ref.snapshot`, 'snapshot must contain immutable SHA boundaries'));
        present.forEach((field) => validateOid(ref.snapshot[field], `${path}.requested_scope_ref.snapshot.${field}`, errors));
        if (ref.snapshot.diff_semantics !== undefined) requiredString(ref.snapshot.diff_semantics, `${path}.requested_scope_ref.snapshot.diff_semantics`, errors);
      }
    }
    const hasArea = ['path_prefixes', 'components', 'symbols'].some((field) => Array.isArray(ref[field]) && ref[field].some((value) => typeof value === 'string' && value.length > 0));
    if (ref.whole_repository !== true && !hasArea) errors.push(issue('empty_scope_request', `${path}.requested_scope_ref`, 'Scope request needs whole_repository or a requested area'));
  });
  for (const field of ['unresolved', 'limitations']) if (Array.isArray(handoff[field])) handoff[field].forEach((item, index) => {
    const path = prefix(`${field}.${index}`);
    if (!requiredObject(item, path, errors)) return;
    validateRequirementIds(item.requirement_ids, `${path}.requirement_ids`, indexes.requirementIds, errors);
    validateScopeWrapperArray(item.scope_refs, `${path}.scope_refs`, indexes, errors);
    requiredString(item[field === 'unresolved' ? 'reason' : 'description'], `${path}.${field === 'unresolved' ? 'reason' : 'description'}`, errors);
  });
  if (Array.isArray(handoff.verification)) handoff.verification.forEach((item, index) => {
    const path = prefix(`verification.${index}`);
    if (!requiredObject(item, path, errors)) return;
    if (!['passed', 'failed', 'not_run'].includes(item.status)) errors.push(issue('invalid_enum', `${path}.status`, 'Unsupported verification status'));
    requiredString(item.summary, `${path}.summary`, errors);
    validateScopeWrapperArray(item.scope_refs, `${path}.scope_refs`, indexes, errors);
  });

  let expectedStatus = null;
  const statuses = [...statusById.values()];
  if (Array.isArray(handoff.findings) && (handoff.findings.length > 0 || statuses.some((entry) => ['частично реализовано', 'не реализовано', 'реализовано с отклонением'].includes(entry.status)))) expectedStatus = 'failed';
  else if ((Array.isArray(handoff.scope_requests) && handoff.scope_requests.length > 0)
      || (Array.isArray(handoff.unresolved) && handoff.unresolved.length > 0)
      || statuses.some((entry) => entry.status === 'невозможно подтвердить' || ['частично', 'недостаточно'].includes(entry.evidence_sufficiency))) expectedStatus = 'blocked';
  else if (statuses.length === indexes.requirementIds.size && statuses.every((entry) => (entry.status === 'реализовано' || entry.status === 'не применимо') && entry.evidence_sufficiency === 'достаточно')) expectedStatus = 'passed';
  if (expectedStatus === null) errors.push(issue('invalid_scope_status', prefix('scope_status'), 'Handoff data cannot produce a valid scope_status'));
  else if (handoff.scope_status !== expectedStatus) errors.push(issue('scope_status_mismatch', prefix('scope_status'), `Expected scope_status ${expectedStatus}`));

  return { errors, expectedStatus, requirementCount: indexes.requirementIds.size, findingCount: Array.isArray(handoff.findings) ? handoff.findings.length : 0 };
}

module.exports = { validateGitPath, validateHandoff, validateOid, validatePacket, validateSnapshotInput };
