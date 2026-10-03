'use strict';

const { Pool } = require('pg');
const { config } = require('../config/env');

const ISOLATION_LEVELS = ['READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE'];

// SQLSTATE class 22 ("data exception"): the database refused the DATA of one
// statement (for example a sum that no longer fits a BIGINT). It says nothing
// about the health of the database itself.
const DATA_EXCEPTION_SQLSTATE_CLASS = '22';

const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.name,
});

let connectionLostHandler = () => {};

/**
 * Registers the function called when a database connection breaks outside of
 * a query (the database went away while the connection was idle or between
 * two statements). Without a listener, Node would kill the process with an
 * unhandled 'error' event.
 */
function onConnectionLost(handler) {
  connectionLostHandler = handler;
}

function notifyConnectionLost(error) {
  connectionLostHandler(error);
}

// Idle connections report their errors through the pool.
pool.on('error', notifyConnectionLost);

/**
 * Runs the given block inside a single database transaction.
 * The block receives the transaction's connection and must use it for every
 * query that belongs to the transaction. Commits when the block resolves,
 * rolls back when it throws.
 */
async function runInTransaction(transactionBlock, { isolationLevel = 'READ COMMITTED' } = {}) {
  if (!ISOLATION_LEVELS.includes(isolationLevel)) {
    throw new Error(`Unsupported isolation level: ${isolationLevel}`);
  }

  const connection = await pool.connect();
  // While a connection is checked out the pool no longer listens to it, so
  // its errors are reported here.
  connection.on('error', notifyConnectionLost);
  try {
    await connection.query(`BEGIN ISOLATION LEVEL ${isolationLevel}`);
    const result = await transactionBlock(connection);
    await connection.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await connection.query('ROLLBACK');
    } catch {
      // The connection is gone, so there is nothing left to roll back. The
      // original error is the one that explains what happened.
    }
    throw error;
  } finally {
    connection.removeListener('error', notifyConnectionLost);
    connection.release();
  }
}

/**
 * True when the error is a SQLSTATE class 22 error: the database rejected the
 * data of the statement, not the connection or the server.
 */
function isDataException(error) {
  return typeof error?.code === 'string' && error.code.length === 5 && error.code.startsWith(DATA_EXCEPTION_SQLSTATE_CLASS);
}

async function closePool() {
  await pool.end();
}

module.exports = { pool, runInTransaction, isDataException, onConnectionLost, closePool };
