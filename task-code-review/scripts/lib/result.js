'use strict';

class ReviewToolError extends Error {
  constructor(exitCode, code, path, message) {
    super(message);
    this.name = 'ReviewToolError';
    this.exitCode = exitCode;
    this.code = code;
    this.path = path || '';
  }
}

function issue(code, path, message) {
  return { code, path: path || '', message };
}

function success(command, result) {
  return { exitCode: 0, body: { ok: true, command, result } };
}

function failure(command, exitCode, errors) {
  return { exitCode, body: { ok: false, command: command || null, errors } };
}

module.exports = { ReviewToolError, issue, success, failure };
