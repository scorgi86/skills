'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateGitPath, validateHandoff, validateOid, validatePacket, validateSnapshotInput } = require('../../lib/validate');
const { parseNameStatus } = require('../../lib/git');
const { handoff, packet } = require('../helpers');

test('primitive validators accept canonical values and reject unsafe ones', () => {
  const errors = [];
  assert.equal(validateOid('a'.repeat(40), 'oid', errors), true);
  assert.equal(validateGitPath('src/space name.js', 'path', errors), true);
  assert.deepEqual(errors, []);

  const invalid = [];
  validateOid('ABC', 'oid', invalid);
  validateGitPath('../secret', 'path', invalid);
  validateGitPath('C:\\secret', 'path2', invalid);
  assert.deepEqual(invalid.map((entry) => entry.code), ['invalid_oid', 'invalid_path', 'invalid_path']);
});

test('name-status parser preserves a UTF-8 path containing a newline', () => {
  const result = parseNameStatus(Buffer.from('M\0space name\nline.txt\0', 'utf8'), 'repo');
  assert.deepEqual(result, [{ repository_id: 'repo', path: 'space name\nline.txt', status: 'M' }]);
});

test('snapshot input requires an absolute repository path', () => {
  const result = validateSnapshotInput({
    repository_id: 'repo', repository_path: 'relative/repo',
    base_sha: 'a'.repeat(40), head_sha: 'b'.repeat(40), merge_base_sha: 'a'.repeat(40),
    diff_from_sha: 'a'.repeat(40), diff_to_sha: 'b'.repeat(40), diff_semantics: 'merge-base-to-head'
  });
  assert.ok(result.errors.some((entry) => entry.code === 'invalid_repository_path'));
});

test('validate-packet accepts the minimum current contract', () => {
  const value = packet();
  const result = validatePacket(value);
  assert.deepEqual(result.errors, []);
  assert.deepEqual([...result.repositoryIds], ['repo']);
  assert.deepEqual([...result.requirementIds], ['R-001']);
});

test('validate-packet reports duplicates, dangling refs, empty scope and materialized diff', () => {
  const value = packet({
    repositories: [packet().repositories[0], packet().repositories[0]],
    changed_files: [{ repository_id: 'missing', path: 'src/a.js' }, { repository_id: 'missing', path: 'src/a.js' }],
    materialized_diff: { digest: 'x' }
  });
  const codes = validatePacket(value).errors.map((entry) => entry.code);
  assert.ok(codes.includes('duplicate_identifier'));
  assert.ok(codes.includes('unknown_repository'));
  assert.ok(codes.includes('duplicate_reference'));
  assert.ok(codes.includes('unsupported_materialized_diff'));

  const empty = packet({ changed_files: [], inspection_scope: [], absence_search_scope: [] });
  assert.ok(validatePacket(empty).errors.some((entry) => entry.code === 'empty_assignment_scope'));
});

test('validate-packet reports malformed scope elements without throwing', () => {
  const inspection = validatePacket(packet({ changed_files: [], inspection_scope: [null] }));
  assert.ok(inspection.errors.some((entry) => entry.path === 'inspection_scope.0' && entry.code === 'invalid_object'));

  const search = validatePacket(packet({ changed_files: [], absence_search_scope: [null] }));
  assert.ok(search.errors.some((entry) => entry.path === 'absence_search_scope.0' && entry.code === 'invalid_object'));
});

test('validate-packet accepts start_line without end_line but rejects the reverse', () => {
  const good = packet({ requirements: [{
    id: 'R-001', criterion: 'x', constraints: [],
    source_ref: { kind: 'repository', code_ref: { repository_id: 'repo', path: 'src/a.js', start_line: 4 } }
  }] });
  assert.deepEqual(validatePacket(good).errors, []);

  good.requirements[0].source_ref.code_ref = { repository_id: 'repo', path: 'src/a.js', end_line: 4 };
  assert.ok(validatePacket(good).errors.some((entry) => entry.code === 'invalid_line'));
});

test('validate-handoff accepts a compact passed handoff', () => {
  const packetValue = packet();
  const result = validateHandoff({ packet: packetValue, handoff: handoff(packetValue) });
  assert.deepEqual(result.errors, []);
  assert.equal(result.expectedStatus, 'passed');
});

test('validate-handoff catches assignment, snapshot, status and verdict errors', () => {
  const packetValue = packet();
  const value = handoff(packetValue, {
    assignment_id: 'wrong',
    scope_status: 'passed',
    global_verdict: 'ACCEPTED',
    snapshot_echo: { repositories: [] },
    requirement_statuses: [{
      id: 'R-001', status: 'невозможно подтвердить', evidence_sufficiency: 'недостаточно',
      evidence_refs: [], search_scope_refs: [], evidence: 'Missing'
    }]
  });
  const codes = validateHandoff({ packet: packetValue, handoff: value }).errors.map((entry) => entry.code);
  assert.ok(codes.includes('assignment_mismatch'));
  assert.ok(codes.includes('global_verdict_forbidden'));
  assert.ok(codes.includes('missing_snapshot_repository'));
  assert.ok(codes.includes('scope_status_mismatch'));
});

test('validate-handoff validates scope request and calculates blocked', () => {
  const packetValue = packet();
  const value = handoff(packetValue, {
    scope_status: 'blocked',
    requirement_statuses: [{
      id: 'R-001', status: 'невозможно подтвердить', evidence_sufficiency: 'недостаточно',
      evidence_refs: [], search_scope_refs: [], evidence: 'External consumer required'
    }],
    scope_requests: [{
      requested_scope_ref: { requested_repository_id: 'other', whole_repository: true },
      reason: 'Required consumer', requirement_ids: ['R-001']
    }]
  });
  const result = validateHandoff({ packet: packetValue, handoff: value });
  assert.deepEqual(result.errors, []);
  assert.equal(result.expectedStatus, 'blocked');
});

test('validate-handoff rejects a scope ref that reuses an id with different provenance', () => {
  const packetValue = packet({
    changed_files: [],
    inspection_scope: [{ id: 'IS-1', repository_id: 'repo', path_prefix: 'src' }]
  });
  const value = handoff(packetValue, {
    limitations: [{
      description: 'Mismatch', requirement_ids: ['R-001'],
      scope_refs: [{ kind: 'inspection_scope_ref', value: { id: 'IS-1', repository_id: 'not-declared', path_prefix: 'other' } }]
    }]
  });
  assert.ok(validateHandoff({ packet: packetValue, handoff: value }).errors.some((entry) => entry.code === 'scope_mismatch'));
});

test('validate-handoff rejects malformed requested scope areas and snapshot', () => {
  const packetValue = packet();
  const value = handoff(packetValue, {
    scope_status: 'blocked',
    requirement_statuses: [{
      id: 'R-001', status: 'невозможно подтвердить', evidence_sufficiency: 'недостаточно',
      evidence_refs: [], search_scope_refs: [], evidence: 'Missing scope'
    }],
    scope_requests: [{
      requested_scope_ref: {
        requested_repository_id: 'other', canonical_remote: 7, whole_repository: false,
        path_prefixes: [123], snapshot: {}
      },
      reason: 'Required consumer', requirement_ids: ['R-001']
    }]
  });
  const codes = validateHandoff({ packet: packetValue, handoff: value }).errors.map((entry) => entry.code);
  assert.ok(codes.includes('invalid_string'));
  assert.ok(codes.includes('invalid_array'));
  assert.ok(codes.includes('invalid_snapshot'));
});
