'use strict';

const VALID_ENVIRONMENT = {
  DATABASE_HOST: 'database',
  DATABASE_PORT: '5432',
  DATABASE_USER: 'kraken',
  DATABASE_PASSWORD: 'secret',
  DATABASE_NAME: 'kraken_payments',
  DATA_DIRECTORY: '/app/data',
};

const originalEnvironment = { ...process.env };

/** Loads config/env with exactly the given variables on top of the original environment. */
function loadConfig(environmentOverrides = {}) {
  for (const variableName of [...Object.keys(VALID_ENVIRONMENT), 'LOG_LEVEL']) {
    delete process.env[variableName];
  }
  for (const [variableName, value] of Object.entries({ ...VALID_ENVIRONMENT, ...environmentOverrides })) {
    if (value !== undefined) {
      process.env[variableName] = value;
    }
  }

  let loadedModule;
  jest.isolateModules(() => {
    loadedModule = require('../../../src/config/env');
  });
  return loadedModule.config;
}

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe('config', () => {
  test('reads the database settings and the data directory', () => {
    expect(loadConfig()).toEqual({
      database: { host: 'database', port: 5432, user: 'kraken', password: 'secret', name: 'kraken_payments' },
      dataDirectory: '/app/data',
      logLevel: 'error',
    });
  });

  test('cannot be changed after it is loaded', () => {
    const config = loadConfig();

    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.database)).toBe(true);
  });

  test.each(Object.keys(VALID_ENVIRONMENT))('fails when %s is missing', (variableName) => {
    expect(() => loadConfig({ [variableName]: undefined })).toThrow(`Missing required environment variable: ${variableName}`);
  });

  test.each(Object.keys(VALID_ENVIRONMENT))('fails when %s is empty', (variableName) => {
    expect(() => loadConfig({ [variableName]: '' })).toThrow(`Missing required environment variable: ${variableName}`);
  });

  test.each(['abc', '0', '65536', '54.32', '-1'])('fails when DATABASE_PORT is "%s"', (port) => {
    expect(() => loadConfig({ DATABASE_PORT: port })).toThrow(`Invalid DATABASE_PORT: ${port}`);
  });

  test.each(['silent', 'error', 'warn', 'info'])('accepts LOG_LEVEL=%s', (logLevel) => {
    expect(loadConfig({ LOG_LEVEL: logLevel }).logLevel).toBe(logLevel);
  });

  test('fails when LOG_LEVEL is not a known level', () => {
    expect(() => loadConfig({ LOG_LEVEL: 'verbose' })).toThrow('Invalid LOG_LEVEL: verbose');
  });
});
