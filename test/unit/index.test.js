'use strict';

// index.js runs the whole application as soon as it is required, so every
// collaborator is a fake and each test requires it again in a fresh registry.
jest.mock('../../src/db/client');
jest.mock('../../src/db/schema');
jest.mock('../../src/db/seeder');
jest.mock('../../src/jobs/depositProcessingJob');
jest.mock('../../src/helpers/logger');

const FAILURE_EXIT_CODE = 1;

let client;
let schema;
let seeder;
let job;
let logger;
let processExit;

/** Requires index.js, which starts main(), and waits for it to settle. */
async function runApplication() {
  jest.isolateModules(() => {
    client = require('../../src/db/client');
    schema = require('../../src/db/schema');
    seeder = require('../../src/db/seeder');
    job = require('../../src/jobs/depositProcessingJob');
    logger = require('../../src/helpers/logger');

    schema.createTables.mockResolvedValue(['001_customers.sql']);
    schema.emptyTables.mockResolvedValue(undefined);
    seeder.seedKnownCustomers.mockResolvedValue(undefined);
    client.closePool.mockResolvedValue(undefined);
    job.describeCurrentJobPosition.mockReturnValue('at file sample1.json, transaction #3 (id some-id)');
    configureFakes();

    require('../../src/index');
  });
  await waitForPendingPromises();
}

let configureFakes = () => {};

async function waitForPendingPromises() {
  for (let turn = 0; turn < 10; turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function connectionLostHandler() {
  return client.onConnectionLost.mock.calls[0][0];
}

beforeEach(() => {
  configureFakes = () => {
    job.runDepositProcessingJob.mockResolvedValue(undefined);
  };
  processExit = jest.spyOn(process, 'exit').mockImplementation(() => undefined);
});

afterEach(() => {
  processExit.mockRestore();
});

describe('successful run', () => {
  test('creates the tables, empties them, seeds and then runs the job', async () => {
    await runApplication();

    const order = [
      schema.createTables.mock.invocationCallOrder[0],
      schema.emptyTables.mock.invocationCallOrder[0],
      seeder.seedKnownCustomers.mock.invocationCallOrder[0],
      job.runDepositProcessingJob.mock.invocationCallOrder[0],
    ];
    expect(order).toEqual([...order].sort((first, second) => first - second));
    expect(order.every((callOrder) => callOrder !== undefined)).toBe(true);
  });

  test('closes the pool and does not force an exit code', async () => {
    await runApplication();

    expect(client.closePool).toHaveBeenCalledTimes(1);
    expect(processExit).not.toHaveBeenCalled();
    expect(logger.logError).not.toHaveBeenCalled();
  });
});

describe('infrastructure failure thrown by a step', () => {
  test.each([
    ['creating the tables', () => schema.createTables.mockRejectedValue(new Error('connection refused'))],
    ['emptying the tables', () => schema.emptyTables.mockRejectedValue(new Error('connection refused'))],
    ['seeding', () => seeder.seedKnownCustomers.mockRejectedValue(new Error('connection refused'))],
    ['running the job', () => job.runDepositProcessingJob.mockRejectedValue(new Error('connection refused'))],
  ])('stops with exit code 1 when %s fails', async (caseName, makeStepFail) => {
    configureFakes = () => {
      job.runDepositProcessingJob.mockResolvedValue(undefined);
      makeStepFail();
    };

    await runApplication();

    expect(processExit).toHaveBeenCalledTimes(1);
    expect(processExit).toHaveBeenCalledWith(FAILURE_EXIT_CODE);
    expect(client.closePool).toHaveBeenCalledTimes(1);
  });

  test('does not run the job when a previous step fails', async () => {
    configureFakes = () => {
      schema.emptyTables.mockRejectedValue(new Error('connection refused'));
    };

    await runApplication();

    expect(seeder.seedKnownCustomers).not.toHaveBeenCalled();
    expect(job.runDepositProcessingJob).not.toHaveBeenCalled();
  });

  test('logs where the job stopped and the error', async () => {
    const jobError = new Error('read ECONNRESET');
    configureFakes = () => {
      job.runDepositProcessingJob.mockRejectedValue(jobError);
    };

    await runApplication();

    expect(logger.logError).toHaveBeenCalledTimes(1);
    expect(logger.logError).toHaveBeenCalledWith(
      'Deposit processing stopped at file sample1.json, transaction #3 (id some-id). The report was not printed',
      jobError,
    );
  });

  test('exits with code 1 after 5 seconds when closing the pool never finishes', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    try {
      configureFakes = () => {
        job.runDepositProcessingJob.mockRejectedValue(new Error('read ECONNRESET'));
        client.closePool.mockReturnValue(new Promise(() => {}));
      };
      await runApplication();
      expect(processExit).not.toHaveBeenCalled();

      jest.advanceTimersByTime(4999);
      expect(processExit).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(processExit).toHaveBeenCalledWith(FAILURE_EXIT_CODE);
    } finally {
      jest.useRealTimers();
    }
  });

  test('still exits with code 1 when closing the pool fails', async () => {
    configureFakes = () => {
      job.runDepositProcessingJob.mockRejectedValue(new Error('read ECONNRESET'));
      client.closePool.mockRejectedValue(new Error('pool already broken'));
    };

    await runApplication();

    expect(processExit).toHaveBeenCalledWith(FAILURE_EXIT_CODE);
  });
});

describe('connection lost outside of a query', () => {
  test('registers a handler for lost connections before anything else', async () => {
    await runApplication();

    expect(client.onConnectionLost).toHaveBeenCalledTimes(1);
    expect(client.onConnectionLost.mock.invocationCallOrder[0]).toBeLessThan(schema.createTables.mock.invocationCallOrder[0]);
  });

  test('the handler takes the same exit path: logs where it stopped, closes the pool, exit code 1', async () => {
    // The job never finishes: the connection is lost while it is running.
    configureFakes = () => {
      job.runDepositProcessingJob.mockReturnValue(new Promise(() => {}));
    };
    await runApplication();
    const connectionError = new Error('read ECONNRESET');

    await connectionLostHandler()(connectionError);

    expect(logger.logError).toHaveBeenCalledWith(
      'Deposit processing stopped at file sample1.json, transaction #3 (id some-id). The report was not printed',
      connectionError,
    );
    expect(client.closePool).toHaveBeenCalledTimes(1);
    expect(processExit).toHaveBeenCalledWith(FAILURE_EXIT_CODE);
  });

  test('a second failure during the stop is ignored', async () => {
    configureFakes = () => {
      job.runDepositProcessingJob.mockReturnValue(new Promise(() => {}));
    };
    await runApplication();

    await connectionLostHandler()(new Error('first'));
    await connectionLostHandler()(new Error('second'));

    expect(logger.logError).toHaveBeenCalledTimes(1);
    expect(client.closePool).toHaveBeenCalledTimes(1);
    expect(processExit).toHaveBeenCalledTimes(1);
  });
});
