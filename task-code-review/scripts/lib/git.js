'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { ReviewToolError } = require('./result');

const execFileAsync = promisify(execFile);

function gitEnvironment() {
  const keep = ['SystemRoot', 'WINDIR', 'PATH', 'PATHEXT', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL'];
  const env = {};
  for (const key of keep) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  Object.assign(env, {
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_PAGER: 'cat',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_CONFIG_COUNT: '4',
    GIT_CONFIG_KEY_0: 'core.hooksPath',
    GIT_CONFIG_VALUE_0: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_CONFIG_KEY_1: 'diff.external',
    GIT_CONFIG_VALUE_1: '',
    GIT_CONFIG_KEY_2: 'core.pager',
    GIT_CONFIG_VALUE_2: 'cat',
    GIT_CONFIG_KEY_3: 'interactive.diffFilter',
    GIT_CONFIG_VALUE_3: ''
  });
  return env;
}

async function runGit(repositoryPath, args, encoding = 'utf8') {
  try {
    return await execFileAsync('git', ['-C', repositoryPath, ...args], {
      encoding,
      env: gitEnvironment(),
      windowsHide: true,
      maxBuffer: 128 * 1024 * 1024
    });
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'EACCES')) {
      throw new ReviewToolError(4, 'git_environment_failure', 'repository_path', 'Git cannot be started');
    }
    throw error;
  }
}

async function verifyRepository(repositoryPath) {
  try {
    await runGit(repositoryPath, ['rev-parse', '--git-dir']);
  } catch (error) {
    if (error instanceof ReviewToolError) throw error;
    throw new ReviewToolError(4, 'git_environment_failure', 'repository_path', 'Path is not a readable Git repository');
  }
}

async function verifyCommit(repositoryPath, oid, field) {
  try {
    await runGit(repositoryPath, ['cat-file', '-e', `${oid}^{commit}`]);
  } catch (error) {
    if (error instanceof ReviewToolError) throw error;
    throw new ReviewToolError(3, 'boundary_object_missing', field, `Commit object is unavailable: ${oid}`);
  }
}

function decodeUtf8Path(buffer, path) {
  const value = buffer.toString('utf8');
  if (!Buffer.from(value, 'utf8').equals(buffer)) {
    throw new ReviewToolError(3, 'unsupported_path_encoding', path, 'Git path is not valid UTF-8');
  }
  return value;
}

function parseNameStatus(output, repositoryId) {
  const fields = [];
  let start = 0;
  for (let index = 0; index < output.length; index += 1) {
    if (output[index] === 0) {
      fields.push(output.subarray(start, index));
      start = index + 1;
    }
  }
  if (start !== output.length || (fields.length && fields.at(-1).length !== 0 && output.at(-1) !== 0)) {
    throw new ReviewToolError(4, 'git_environment_failure', '', 'Git returned malformed NUL-delimited output');
  }
  if (fields.length && fields.at(-1).length === 0) fields.pop();
  if (fields.length % 2 !== 0) {
    throw new ReviewToolError(4, 'git_environment_failure', '', 'Git returned an incomplete name-status record');
  }

  const changedFiles = [];
  const seen = new Set();
  for (let index = 0; index < fields.length; index += 2) {
    const status = fields[index].toString('ascii');
    if (!['A', 'M', 'D', 'T'].includes(status)) {
      throw new ReviewToolError(3, 'unsupported_diff_status', `changed_files.${changedFiles.length}.status`, `Unsupported Git status: ${status}`);
    }
    const pathBuffer = fields[index + 1];
    const filePath = decodeUtf8Path(pathBuffer, `changed_files.${changedFiles.length}.path`);
    if (seen.has(filePath)) {
      throw new ReviewToolError(3, 'duplicate_changed_file', `changed_files.${changedFiles.length}.path`, `Duplicate changed path: ${filePath}`);
    }
    seen.add(filePath);
    changedFiles.push({ repository_id: repositoryId, path: filePath, status });
  }
  changedFiles.sort((left, right) => Buffer.compare(Buffer.from(left.path, 'utf8'), Buffer.from(right.path, 'utf8')));
  return changedFiles;
}

async function buildSnapshot(input) {
  await verifyRepository(input.repository_path);
  const boundaries = ['base_sha', 'head_sha', 'merge_base_sha', 'diff_from_sha', 'diff_to_sha'];
  for (const field of boundaries) await verifyCommit(input.repository_path, input[field], field);

  let output;
  try {
    ({ stdout: output } = await runGit(input.repository_path, [
      'diff-tree', '-r', '--name-status', '-z', '--no-renames', '--no-commit-id',
      input.diff_from_sha, input.diff_to_sha
    ], 'buffer'));
  } catch (error) {
    if (error instanceof ReviewToolError) throw error;
    throw new ReviewToolError(4, 'git_environment_failure', '', 'Git could not build the requested diff');
  }

  return {
    repository_id: input.repository_id,
    base_sha: input.base_sha,
    head_sha: input.head_sha,
    merge_base_sha: input.merge_base_sha,
    diff_from_sha: input.diff_from_sha,
    diff_to_sha: input.diff_to_sha,
    diff_semantics: input.diff_semantics,
    changed_files: parseNameStatus(output, input.repository_id)
  };
}

module.exports = { buildSnapshot, gitEnvironment, parseNameStatus };
