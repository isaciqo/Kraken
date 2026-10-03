'use strict';

const { closePool, onConnectionLost } = require('./db/client');
const { createTables, emptyTables } = require('./db/schema');
const { seedKnownCustomers } = require('./db/seeder');
const { runDepositProcessingJob, describeCurrentJobPosition } = require('./jobs/depositProcessingJob');
const { logInfo, logError } = require('./helpers/logger');

const FAILURE_EXIT_CODE = 1;
// How long the controlled stop waits for the connections to close before
// exiting anyway. A database that is gone may never answer.
const CLOSE_POOL_TIMEOUT_MS = 5000;

let isStoppingAfterFailure = false;

/**
 * Single exit path for every infrastructure failure, whether it was thrown by
 * a query or emitted by a connection outside of a query: says on stderr where
 * the job stopped, closes the connections and exits with code 1. The report
 * is never printed after a failure.
 */
async function stopAfterFailure(error) {
  if (isStoppingAfterFailure) {
    return;
  }
  isStoppingAfterFailure = true;

  logError(`Deposit processing stopped ${describeCurrentJobPosition()}. The report was not printed`, error);

  const forcedExitTimer = setTimeout(() => process.exit(FAILURE_EXIT_CODE), CLOSE_POOL_TIMEOUT_MS);
  try {
    await closePool();
  } catch {
    // The connections are already broken; there is nothing left to close.
  }
  clearTimeout(forcedExitTimer);
  process.exit(FAILURE_EXIT_CODE);
}

async function main() {
  onConnectionLost(stopAfterFailure);

  try {
    const schemaFileNames = await createTables();
    logInfo(`Tables created from: ${schemaFileNames.join(', ')}`);

    // Every run starts from an empty database, even when the database
    // container was left running by a previous `docker-compose up`.
    await emptyTables();
    logInfo('Tables emptied');

    await seedKnownCustomers();
    logInfo('Known customers seeded');

    await runDepositProcessingJob();
  } catch (error) {
    await stopAfterFailure(error);
    return;
  }

  await closePool();
}

main();
