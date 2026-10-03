'use strict';

let stderrWrite;
let stdoutWrite;

/** Loads the logger with the given LOG_LEVEL (config/env reads it when required). */
function loadLoggerWithLevel(logLevel) {
  let logger;
  jest.isolateModules(() => {
    if (logLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = logLevel;
    }
    logger = require('../../../src/helpers/logger');
  });
  return logger;
}

function loggedLines() {
  return stderrWrite.mock.calls.map(([line]) => line);
}

beforeEach(() => {
  stderrWrite = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  stdoutWrite = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterEach(() => {
  stderrWrite.mockRestore();
  stdoutWrite.mockRestore();
  process.env.LOG_LEVEL = 'silent';
});

describe('logger', () => {
  test('by default logs only errors', () => {
    const { logInfo, logWarning, logError } = loadLoggerWithLevel(undefined);

    logInfo('an info');
    logWarning('a warning');
    logError('an error');

    expect(loggedLines()).toEqual(['[error] an error\n']);
  });

  test.each([
    ['silent', []],
    ['error', ['[error] an error\n']],
    ['warn', ['[warn] a warning\n', '[error] an error\n']],
    ['info', ['[info] an info\n', '[warn] a warning\n', '[error] an error\n']],
  ])('with LOG_LEVEL=%s logs %j', (logLevel, expectedLines) => {
    const { logInfo, logWarning, logError } = loadLoggerWithLevel(logLevel);

    logInfo('an info');
    logWarning('a warning');
    logError('an error');

    expect(loggedLines()).toEqual(expectedLines);
  });

  test('never writes to stdout, which is reserved for the report', () => {
    const { logInfo, logWarning, logError } = loadLoggerWithLevel('info');

    logInfo('an info');
    logWarning('a warning');
    logError('an error', new Error('details'));

    expect(stdoutWrite).not.toHaveBeenCalled();
  });

  test('logError includes the stack of the error', () => {
    const { logError } = loadLoggerWithLevel('error');
    const error = new Error('read ECONNRESET');

    logError('Deposit processing stopped', error);

    expect(loggedLines()[0]).toBe(`[error] Deposit processing stopped: ${error.stack}\n`);
  });

  test('logError accepts an error that has no stack', () => {
    const { logError } = loadLoggerWithLevel('error');

    logError('Deposit processing stopped', 'plain text reason');

    expect(loggedLines()[0]).toBe('[error] Deposit processing stopped: plain text reason\n');
  });
});
