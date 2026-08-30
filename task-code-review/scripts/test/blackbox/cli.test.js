'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { handoff, packet } = require('../helpers');

const cli = path.resolve(__dirname, '../../review-tools.js');

function run(args, input) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    input, encoding: 'utf8', windowsHide: true
  });
  return { ...result, body: JSON.parse(result.stdout) };
}

test('CLI validates packet through stdin and emits only JSON stdout', () => {
  const result = run(['validate-packet', '--input', '-'], JSON.stringify(packet()));
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.equal(result.body.ok, true);
  assert.equal(result.body.result.valid, true);
});

test('CLI returns exit 2 and stable envelope for malformed JSON', () => {
  const result = run(['validate-packet', '--input', '-'], '{bad');
  assert.equal(result.status, 2);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.errors[0].code, 'malformed_json');
});

test('CLI returns exit 2 for malformed scope elements', () => {
  const value = packet({ changed_files: [], inspection_scope: [null] });
  const result = run(['validate-packet', '--input', '-'], JSON.stringify(value));
  assert.equal(result.status, 2);
  assert.equal(result.body.errors[0].code, 'invalid_object');
  assert.equal(result.body.errors[0].path, 'inspection_scope.0');
});

test('CLI returns exit 2 for unknown command', () => {
  const result = run(['unknown', '--input', '-'], '{}');
  assert.equal(result.status, 2);
  assert.equal(result.body.command, 'unknown');
  assert.equal(result.body.errors[0].code, 'unknown_command');
});

test('CLI dispatches validate-handoff', () => {
  const packetValue = packet();
  const result = run(['validate-handoff', '--input', '-'], JSON.stringify({ packet: packetValue, handoff: handoff(packetValue) }));
  assert.equal(result.status, 0);
  assert.equal(result.body.command, 'validate-handoff');
  assert.equal(result.body.result.scope_status, 'passed');
});

test('CLI dispatches snapshot and rejects invalid input before Git', () => {
  const result = run(['snapshot', '--input', '-'], JSON.stringify({ repository_id: 'repo', repository_path: 'relative' }));
  assert.equal(result.status, 2);
  assert.equal(result.body.command, 'snapshot');
  assert.ok(result.body.errors.some((entry) => entry.code === 'invalid_repository_path'));
});

test('CLI exposes exit 3 for an unavailable immutable boundary', (t) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'task-review-cli-boundary-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  execFileSync('git', ['-C', repo, 'init']);
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'Task Review Test']);
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'task-review@example.test']);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a');
  execFileSync('git', ['-C', repo, 'add', '-A']);
  execFileSync('git', ['-C', repo, 'commit', '-m', 'base']);
  const oid = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const missing = 'f'.repeat(40);
  const result = run(['snapshot', '--input', '-'], JSON.stringify({
    repository_id: 'repo', repository_path: repo,
    base_sha: oid, head_sha: missing, merge_base_sha: oid,
    diff_from_sha: oid, diff_to_sha: missing, diff_semantics: 'merge-base-to-head'
  }));
  assert.equal(result.status, 3);
  assert.equal(result.body.errors[0].code, 'boundary_object_missing');
});

test('CLI exposes exit 4 for a non-repository environment', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'task-review-cli-environment-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const oid = 'a'.repeat(40);
  const result = run(['snapshot', '--input', '-'], JSON.stringify({
    repository_id: 'repo', repository_path: directory,
    base_sha: oid, head_sha: oid, merge_base_sha: oid,
    diff_from_sha: oid, diff_to_sha: oid, diff_semantics: 'merge-base-to-head'
  }));
  assert.equal(result.status, 4);
  assert.equal(result.body.errors[0].code, 'git_environment_failure');
});
