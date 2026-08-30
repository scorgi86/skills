'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildSnapshot } = require('../../lib/git');

function git(repo, args, options = {}) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true, ...options }).trim();
}

function write(repo, name, value) {
  const target = path.join(repo, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, value);
}

test('snapshot returns complete A/M/D/T inventory without repository side effects', async (t) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'task-review-snapshot-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  git(repo, ['init']);
  git(repo, ['config', 'user.name', 'Task Review Test']);
  git(repo, ['config', 'user.email', 'task-review@example.test']);

  write(repo, 'modify.txt', 'before\n');
  write(repo, 'delete.txt', 'delete\n');
  write(repo, 'type.txt', 'regular\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-m', 'base']);
  const base = git(repo, ['rev-parse', 'HEAD']);

  write(repo, 'modify.txt', 'after\n');
  fs.rmSync(path.join(repo, 'delete.txt'));
  write(repo, 'added.txt', 'added\n');
  write(repo, 'space name-юникод.txt', 'unusual utf8 path\n');
  git(repo, ['add', '-A']);
  git(repo, ['update-index', '--add', '--cacheinfo', `160000,${base},type.txt`]);
  git(repo, ['commit', '-m', 'head']);
  const head = git(repo, ['rev-parse', 'HEAD']);
  const statusBefore = git(repo, ['status', '--porcelain=v1']);
  const headBefore = git(repo, ['rev-parse', 'HEAD']);
  const indexBefore = git(repo, ['write-tree']);
  const refsBefore = git(repo, ['show-ref']);

  const result = await buildSnapshot({
    repository_id: 'repo', repository_path: repo,
    base_sha: base, head_sha: head, merge_base_sha: base,
    diff_from_sha: base, diff_to_sha: head, diff_semantics: 'merge-base-to-head'
  });

  assert.deepEqual(new Set(result.changed_files.map((entry) => entry.status)), new Set(['A', 'M', 'D', 'T']));
  assert.ok(result.changed_files.some((entry) => entry.path === 'space name-юникод.txt'));
  assert.equal(git(repo, ['status', '--porcelain=v1']), statusBefore);
  assert.equal(git(repo, ['rev-parse', 'HEAD']), headBefore);
  assert.equal(git(repo, ['write-tree']), indexBefore);
  assert.equal(git(repo, ['show-ref']), refsBefore);
});

test('snapshot supports an empty diff', async (t) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'task-review-empty-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  git(repo, ['init']);
  git(repo, ['config', 'user.name', 'Task Review Test']);
  git(repo, ['config', 'user.email', 'task-review@example.test']);
  write(repo, 'a.txt', 'a');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-m', 'base']);
  const oid = git(repo, ['rev-parse', 'HEAD']);
  const result = await buildSnapshot({
    repository_id: 'repo', repository_path: repo,
    base_sha: oid, head_sha: oid, merge_base_sha: oid,
    diff_from_sha: oid, diff_to_sha: oid, diff_semantics: 'merge-base-to-head'
  });
  assert.deepEqual(result.changed_files, []);
});

test('snapshot preserves an actual newline path stored in a Git tree', async (t) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'task-review-newline-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  git(repo, ['init']);
  git(repo, ['config', 'user.name', 'Task Review Test']);
  git(repo, ['config', 'user.email', 'task-review@example.test']);
  write(repo, 'base.txt', 'base');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-m', 'base']);
  const base = git(repo, ['rev-parse', 'HEAD']);
  const blob = execFileSync('git', ['-C', repo, 'hash-object', '-w', '--stdin'], { input: 'newline', encoding: 'utf8' }).trim();
  const treeInput = Buffer.from(`100644 blob ${blob}\tspace name\nline.txt\0`, 'utf8');
  const tree = execFileSync('git', ['-C', repo, 'mktree', '-z'], { input: treeInput, encoding: 'utf8' }).trim();
  const head = execFileSync('git', ['-C', repo, 'commit-tree', tree, '-p', base, '-m', 'newline tree'], { encoding: 'utf8' }).trim();
  const result = await buildSnapshot({
    repository_id: 'repo', repository_path: repo,
    base_sha: base, head_sha: head, merge_base_sha: base,
    diff_from_sha: base, diff_to_sha: head, diff_semantics: 'merge-base-to-head'
  });
  assert.ok(result.changed_files.some((entry) => entry.path === 'space name\nline.txt'));
});

test('snapshot rejects an unavailable boundary without fetching', async (t) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'task-review-missing-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  git(repo, ['init']);
  git(repo, ['config', 'user.name', 'Task Review Test']);
  git(repo, ['config', 'user.email', 'task-review@example.test']);
  write(repo, 'a.txt', 'a');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-m', 'base']);
  const oid = git(repo, ['rev-parse', 'HEAD']);
  const missing = 'f'.repeat(40);
  await assert.rejects(() => buildSnapshot({
    repository_id: 'repo', repository_path: repo,
    base_sha: oid, head_sha: missing, merge_base_sha: oid,
    diff_from_sha: oid, diff_to_sha: missing, diff_semantics: 'merge-base-to-head'
  }), (error) => error.exitCode === 3 && error.code === 'boundary_object_missing');
});
