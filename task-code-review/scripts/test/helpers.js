'use strict';

const OID_A = 'a'.repeat(40);
const OID_B = 'b'.repeat(40);

function repository(overrides = {}) {
  return {
    repository_id: 'repo',
    path: 'C:\\work\\repo',
    canonical_remote: 'https://example.test/repo.git',
    base_sha: OID_A,
    head_sha: OID_B,
    merge_base_sha: OID_A,
    diff_from_sha: OID_A,
    diff_to_sha: OID_B,
    diff_semantics: 'merge-base-to-head',
    ...overrides
  };
}

function packet(overrides = {}) {
  return {
    assignment_id: 'assignment-1',
    repositories: [repository()],
    requirements: [{
      id: 'R-001',
      criterion: 'Observable behavior',
      constraints: [],
      source_ref: { kind: 'task', source_id: 'TASK', section: 'Acceptance' }
    }],
    changed_files: [{ repository_id: 'repo', path: 'src/a.js' }],
    inspection_scope: [],
    absence_search_scope: [],
    semantic_scope: [],
    hard_exclusions: [],
    permissions: { read_only: true },
    ...overrides
  };
}

function snapshotEcho(packetValue) {
  return {
    repositories: packetValue.repositories.map(({ path: _path, ...value }) => value)
  };
}

function handoff(packetValue, overrides = {}) {
  return {
    assignment_id: packetValue.assignment_id,
    scope_status: 'passed',
    snapshot_echo: snapshotEcho(packetValue),
    requirement_statuses: packetValue.requirements.map((requirement) => ({
      id: requirement.id,
      status: 'реализовано',
      evidence_sufficiency: 'достаточно',
      evidence_refs: [],
      search_scope_refs: [],
      evidence: 'Confirmed by source inspection'
    })),
    findings: [],
    reviewed_files: [],
    discovered_consumers: [],
    scope_expansions: [],
    scope_requests: [],
    unresolved: [],
    verification: [],
    limitations: [],
    ...overrides
  };
}

module.exports = { handoff, packet, repository };
