#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { buildSnapshot } = require('./lib/git');
const { ReviewToolError, failure, issue, success } = require('./lib/result');
const { validateHandoff, validatePacket, validateSnapshotInput } = require('./lib/validate');

function parseArguments(argv) {
  const command = argv[0] || null;
  if (!['snapshot', 'validate-packet', 'validate-handoff'].includes(command)) {
    throw new ReviewToolError(2, 'unknown_command', 'command', 'Expected snapshot, validate-packet, or validate-handoff');
  }
  if (argv[1] !== '--input' || argv.length !== 3) {
    throw new ReviewToolError(2, 'invalid_arguments', '', 'Usage: review-tools.js <command> --input <json-file|->');
  }
  return { command, inputPath: argv[2] };
}

function readInput(inputPath) {
  let text;
  try {
    text = inputPath === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(inputPath, 'utf8');
  } catch (error) {
    throw new ReviewToolError(4, 'input_read_failure', '', `Cannot read input: ${error.message}`);
  }
  try {
    const value = JSON.parse(text);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new ReviewToolError(2, 'invalid_object', '', 'Input must be a JSON object');
    }
    return value;
  } catch (error) {
    if (error instanceof ReviewToolError) throw error;
    throw new ReviewToolError(2, 'malformed_json', '', 'Input is not valid JSON');
  }
}

async function execute(command, input) {
  if (command === 'snapshot') {
    const validation = validateSnapshotInput(input);
    if (validation.errors.length) return failure(command, 2, validation.errors);
    return success(command, await buildSnapshot(input));
  }
  if (command === 'validate-packet') {
    const validation = validatePacket(input);
    if (validation.errors.length) return failure(command, 2, validation.errors);
    return success(command, {
      assignment_id: input.assignment_id,
      valid: true,
      counts: {
        repositories: input.repositories.length,
        requirements: input.requirements.length,
        changed_files: input.changed_files.length
      }
    });
  }
  const validation = validateHandoff(input);
  if (validation.errors.length) return failure(command, 2, validation.errors);
  return success(command, {
    assignment_id: input.handoff.assignment_id,
    valid: true,
    scope_status: validation.expectedStatus,
    counts: { requirements: validation.requirementCount, findings: validation.findingCount }
  });
}

async function main(argv = process.argv.slice(2)) {
  let command = argv[0] || null;
  let response;
  try {
    const parsed = parseArguments(argv);
    command = parsed.command;
    response = await execute(command, readInput(parsed.inputPath));
  } catch (error) {
    if (error instanceof ReviewToolError) response = failure(command, error.exitCode, [issue(error.code, error.path, error.message)]);
    else response = failure(command, 4, [issue('cli_failure', '', error && error.message ? error.message : 'Unexpected CLI failure')]);
  }
  process.stdout.write(`${JSON.stringify(response.body)}\n`);
  return response.exitCode;
}

if (require.main === module) {
  main().then((exitCode) => { process.exitCode = exitCode; });
}

module.exports = { execute, main, parseArguments, readInput };
