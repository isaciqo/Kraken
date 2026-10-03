'use strict';

const { config, LOG_LEVELS } = require('../config/env');

// Every log line goes to stderr: stdout is reserved for the deposit report.
function writeLogLine(level, message) {
  if (LOG_LEVELS.indexOf(level) <= LOG_LEVELS.indexOf(config.logLevel)) {
    process.stderr.write(`[${level}] ${message}\n`);
  }
}

function logInfo(message) {
  writeLogLine('info', message);
}

function logWarning(message) {
  writeLogLine('warn', message);
}

function logError(message, error) {
  const errorDetails = error ? `: ${error.stack ?? error}` : '';
  writeLogLine('error', `${message}${errorDetails}`);
}

module.exports = { logInfo, logWarning, logError };
