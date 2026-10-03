'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { runInTransaction } = require('./client');

const SCHEMAS_DIRECTORY = path.join(__dirname, 'schemas');

// Arbitrary constant that identifies the advisory lock taken while the tables
// are created or emptied.
const SCHEMA_CREATION_LOCK_KEY = 7119001;

async function listSchemaFilesInOrder() {
  const fileNames = await fs.readdir(SCHEMAS_DIRECTORY);
  return fileNames.filter((fileName) => fileName.endsWith('.sql')).sort();
}

/**
 * Creates every table by running the .sql files of db/schemas in file name order.
 * All files run in one transaction, under an advisory lock: concurrent
 * CREATE TABLE IF NOT EXISTS statements from two instances can fail each other.
 */
async function createTables() {
  const schemaFileNames = await listSchemaFilesInOrder();

  await runInTransaction(async (connection) => {
    await connection.query('SELECT pg_advisory_xact_lock($1)', [SCHEMA_CREATION_LOCK_KEY]);

    for (const schemaFileName of schemaFileNames) {
      const schemaSql = await fs.readFile(path.join(SCHEMAS_DIRECTORY, schemaFileName), 'utf8');
      await connection.query(schemaSql);
    }
  });

  return schemaFileNames;
}

/**
 * Removes every row of every table, so a run never sees data left by a
 * previous run against the same database. Runs under the same advisory lock
 * as the table creation.
 */
async function emptyTables() {
  await runInTransaction(async (connection) => {
    await connection.query('SELECT pg_advisory_xact_lock($1)', [SCHEMA_CREATION_LOCK_KEY]);
    await connection.query('TRUNCATE deposits, customer_accounts, customers');
  });
}

module.exports = { createTables, emptyTables };
