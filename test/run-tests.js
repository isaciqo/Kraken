'use strict';

// Runs the application with docker-compose against each suite and compares
// the application's stdout with the expected report, byte by byte.
//
//   node test/run-tests.js
//
// Needs only Node and Docker on the host. Exits with code 1 when any suite
// differs from its expected output.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.join(__dirname, '..');

const SUITES = [
  {
    name: 'samples (data/)',
    composeFiles: ['docker-compose.yml'],
    expectedOutputFile: path.join(__dirname, 'expected', 'samples.txt'),
  },
  {
    name: 'fixtures (test/fixtures/)',
    composeFiles: ['docker-compose.yml', 'docker-compose.test.yml'],
    expectedOutputFile: path.join(__dirname, 'expected', 'fixtures.txt'),
  },
];

function runCommand(command, commandArguments) {
  const result = spawnSync(command, commandArguments, { cwd: PROJECT_ROOT, encoding: 'utf8' });
  if (result.error) {
    throw result.error;
  }
  return result;
}

function runCompose(composeFiles, composeArguments) {
  const fileArguments = composeFiles.flatMap((composeFile) => ['-f', composeFile]);
  return runCommand('docker-compose', [...fileArguments, ...composeArguments]);
}

function runSuite({ name, composeFiles, expectedOutputFile }) {
  // Start from scratch: a previous run must not leave containers behind.
  runCompose(composeFiles, ['down']);

  const upResult = runCompose(composeFiles, ['up', '--build', '-d']);
  if (upResult.status !== 0) {
    throw new Error(`docker-compose up failed for ${name}:\n${upResult.stderr}`);
  }

  const appContainerId = runCompose(composeFiles, ['ps', '-a', '-q', 'app']).stdout.trim();
  const exitCode = runCommand('docker', ['wait', appContainerId]).stdout.trim();
  // `docker logs` keeps the container's stdout and stderr apart.
  const appLogs = runCommand('docker', ['logs', appContainerId]);

  runCompose(composeFiles, ['down']);

  const expectedOutput = fs.readFileSync(expectedOutputFile, 'utf8').replaceAll('\r\n', '\n');
  const obtainedOutput = appLogs.stdout;

  const failures = [];
  if (exitCode !== '0') {
    failures.push(`exit code was ${exitCode}, expected 0`);
  }
  if (appLogs.stderr !== '') {
    failures.push(`stderr is not empty:\n${appLogs.stderr}`);
  }
  if (obtainedOutput !== expectedOutput) {
    const expectedLines = expectedOutput.split('\n');
    const obtainedLines = obtainedOutput.split('\n');
    const lineCount = Math.max(expectedLines.length, obtainedLines.length);
    for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
      if (expectedLines[lineIndex] !== obtainedLines[lineIndex]) {
        failures.push(
          `line ${lineIndex + 1}\n    expected: ${expectedLines[lineIndex] ?? '(nothing)'}\n    obtained: ${obtainedLines[lineIndex] ?? '(nothing)'}`,
        );
      }
    }
  }
  return failures;
}

let hasFailedSuite = false;
for (const suite of SUITES) {
  const failures = runSuite(suite);
  if (failures.length === 0) {
    console.log(`PASS  ${suite.name}`);
  } else {
    hasFailedSuite = true;
    console.log(`FAIL  ${suite.name}`);
    for (const failure of failures) {
      console.log(`  ${failure}`);
    }
  }
}

process.exitCode = hasFailedSuite ? 1 : 0;
