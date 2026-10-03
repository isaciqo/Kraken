'use strict';

// From least to most verbose. A level also shows every level before it.
const LOG_LEVELS = ['silent', 'error', 'warn', 'info'];

function readRequiredVariable(variableName) {
  const value = process.env[variableName];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${variableName}`);
  }
  return value;
}

function readDatabasePort() {
  const rawPort = readRequiredVariable('DATABASE_PORT');
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid DATABASE_PORT: ${rawPort}`);
  }
  return port;
}

function readLogLevel() {
  // By default only failures that stop the job are logged. The reasons why
  // files and transactions were skipped only appear with LOG_LEVEL=warn.
  const logLevel = process.env.LOG_LEVEL ?? 'error';
  if (!LOG_LEVELS.includes(logLevel)) {
    throw new Error(`Invalid LOG_LEVEL: ${logLevel} (expected one of ${LOG_LEVELS.join(', ')})`);
  }
  return logLevel;
}

const config = Object.freeze({
  database: Object.freeze({
    host: readRequiredVariable('DATABASE_HOST'),
    port: readDatabasePort(),
    user: readRequiredVariable('DATABASE_USER'),
    password: readRequiredVariable('DATABASE_PASSWORD'),
    name: readRequiredVariable('DATABASE_NAME'),
  }),
  dataDirectory: readRequiredVariable('DATA_DIRECTORY'),
  logLevel: readLogLevel(),
});

module.exports = { config, LOG_LEVELS };
