'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { config } = require('../config/env');
const { logInfo, logWarning } = require('../helpers/logger');
const { validateTransactionFileContent } = require('../validators/transactionFileValidator');
const { validateTransaction } = require('../validators/transactionValidator');
const { processTransaction, isSkippedOutcome } = require('../services/depositService');
const { buildDepositReportLines } = require('../services/depositReportService');

const TRANSACTION_FILE_EXTENSION = '.json';

// Where the job currently is, in words. Read when the job has to stop because
// of an infrastructure failure, to say where it stopped.
let currentJobPosition = 'before reading the transaction files';

function describeCurrentJobPosition() {
  return currentJobPosition;
}

/**
 * Lists the .json files of the data directory in alphabetical order. Any other
 * entry (other extensions, directories) is ignored.
 * The order is a plain code unit comparison, independent of the machine locale,
 * so every run reads the files in the same order.
 */
async function listTransactionFileNamesInOrder() {
  const directoryEntries = await fs.readdir(config.dataDirectory, { withFileTypes: true });
  return directoryEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(TRANSACTION_FILE_EXTENSION))
    .map((entry) => entry.name)
    .sort();
}

/**
 * Reads and validates one transaction file. Returns its transactions, or null
 * when the file cannot be read or is not a valid transaction file.
 * The whole file is loaded into memory.
 */
async function readTransactionsFromFile(fileName) {
  let fileContent;
  try {
    fileContent = await fs.readFile(path.join(config.dataDirectory, fileName), 'utf8');
  } catch (error) {
    logWarning(`File ${fileName} skipped: could not be read (${error.message})`);
    return null;
  }

  const fileValidation = validateTransactionFileContent(fileContent);
  if (!fileValidation.isValid) {
    logWarning(`File ${fileName} skipped: ${fileValidation.reason}`);
    return null;
  }
  return fileValidation.transactions;
}

async function processTransactionFile(fileName) {
  currentJobPosition = `at file ${fileName}, before its first transaction`;

  const rawTransactions = await readTransactionsFromFile(fileName);
  if (rawTransactions === null) {
    return;
  }

  for (const [transactionIndex, rawTransaction] of rawTransactions.entries()) {
    const transactionLabel = `File ${fileName}, transaction #${transactionIndex}`;

    const transactionValidation = validateTransaction(rawTransaction);
    if (!transactionValidation.isValid) {
      logWarning(`${transactionLabel} skipped: ${transactionValidation.reason}`);
      continue;
    }

    const { transaction } = transactionValidation;
    currentJobPosition = `at file ${fileName}, transaction #${transactionIndex} (id ${transaction.transactionId})`;

    const depositOutcome = await processTransaction(transaction, fileName);
    const outcomeMessage = `${transactionLabel} (id ${transaction.transactionId}) ${depositOutcome}`;
    if (isSkippedOutcome(depositOutcome)) {
      logWarning(outcomeMessage);
    } else {
      logInfo(outcomeMessage);
    }
  }
}

function printReport(reportLines) {
  process.stdout.write(`${reportLines.join('\n')}\n`);
}

/**
 * Core flow of the application: processes every transaction file of the data
 * directory, then prints the deposit report read from the database.
 */
async function runDepositProcessingJob() {
  const transactionFileNames = await listTransactionFileNamesInOrder();

  for (const fileName of transactionFileNames) {
    await processTransactionFile(fileName);
  }

  currentJobPosition = 'after all transaction files, while building the report';
  const reportLines = await buildDepositReportLines();

  currentJobPosition = 'after printing the report';
  printReport(reportLines);
}

module.exports = { runDepositProcessingJob, describeCurrentJobPosition };
