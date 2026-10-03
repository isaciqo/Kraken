'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The job reads real files from a temporary directory. config/env reads
// DATA_DIRECTORY when it is first required, so it is set before the requires.
const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'kraken-payments-job-test-'));
process.env.DATA_DIRECTORY = dataDirectory;

// No database: the validators, the deposit service and the report service
// are the real ones; only the transaction runner and the repositories are fakes.
const mockConnection = { name: 'fake connection' };
jest.mock('../../../src/db/client', () => ({
  runInTransaction: jest.fn((transactionBlock) => transactionBlock(mockConnection)),
  isDataException: jest.requireActual('../../../src/db/client').isDataException,
}));
jest.mock('../../../src/repositories/customerRepository');
jest.mock('../../../src/repositories/customerAccountRepository');
jest.mock('../../../src/repositories/depositRepository');

const customerRepository = require('../../../src/repositories/customerRepository');
const customerAccountRepository = require('../../../src/repositories/customerAccountRepository');
const depositRepository = require('../../../src/repositories/depositRepository');
const { runDepositProcessingJob, describeCurrentJobPosition } = require('../../../src/jobs/depositProcessingJob');

const REPORT_LINES = [
  'Deposited for Jadzia Dax: count=2 sum=30.00 USD',
  'Deposited without known user: count=0 sum=0.00 USD',
  'Smallest valid deposit: 10.00 USD',
  'Largest valid deposit: 20.00 USD',
];

let stdoutWrite;

function transactionId(sequence) {
  return `fa000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

function transactionJson(sequence, { amount = '10.00', id = transactionId(sequence) } = {}) {
  return `{"id": ${JSON.stringify(id)}, "to": {"routing_number": "011000015", "account_number": "6622085487"}, "from": {"routing_number": "322271627", "account_number": "5550001111"}, "amount": {"amount": ${amount}, "currency": "USD"}}`;
}

function writeDataFile(fileName, content) {
  fs.writeFileSync(path.join(dataDirectory, fileName), content);
}

function writeTransactionFile(fileName, transactionsJson) {
  writeDataFile(fileName, `{"transactions": [${transactionsJson.join(', ')}]}`);
}

function emptyDataDirectory() {
  for (const entryName of fs.readdirSync(dataDirectory)) {
    fs.rmSync(path.join(dataDirectory, entryName), { recursive: true });
  }
}

function storedTransactionIds() {
  return depositRepository.insertDepositIfAbsent.mock.calls.map(([, deposit]) => deposit.transactionId);
}

function printedText() {
  return stdoutWrite.mock.calls.map(([text]) => text).join('');
}

function databaseError(sqlState) {
  return Object.assign(new Error(`database error ${sqlState}`), { code: sqlState });
}

beforeEach(() => {
  jest.clearAllMocks();
  emptyDataDirectory();
  stdoutWrite = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

  customerAccountRepository.isKnownRoutingNumber.mockResolvedValue(true);
  customerAccountRepository.findCustomerIdByAccount.mockResolvedValue(1);
  depositRepository.insertDepositIfAbsent.mockResolvedValue(true);
  customerRepository.addDepositToCustomerTotals.mockResolvedValue(undefined);

  customerRepository.listCustomerDepositTotals.mockResolvedValue([
    { name: 'Jadzia Dax', depositCount: '2', totalDepositedCents: '3000' },
  ]);
  depositRepository.getTotalsOfDepositsWithoutCustomer.mockResolvedValue({ depositCount: '0', totalDepositedCents: '0' });
  depositRepository.getSmallestAndLargestDepositCents.mockResolvedValue({
    smallestDepositCents: '1000',
    largestDepositCents: '2000',
  });
});

afterEach(() => {
  stdoutWrite.mockRestore();
});

afterAll(() => {
  fs.rmSync(dataDirectory, { recursive: true });
});

describe('runDepositProcessingJob', () => {
  describe('normal flow', () => {
    test('stores every valid transaction and prints the report read from the repositories', async () => {
      writeTransactionFile('sample1.json', [transactionJson(1), transactionJson(2, { amount: '20.00' })]);

      await runDepositProcessingJob();

      expect(storedTransactionIds()).toEqual([transactionId(1), transactionId(2)]);
      expect(printedText()).toBe(`${REPORT_LINES.join('\n')}\n`);
    });

    test('prints the report once, after all the files were processed', async () => {
      writeTransactionFile('a.json', [transactionJson(1)]);
      writeTransactionFile('b.json', [transactionJson(2)]);

      await runDepositProcessingJob();

      expect(stdoutWrite).toHaveBeenCalledTimes(1);
      const lastInsertOrder = depositRepository.insertDepositIfAbsent.mock.invocationCallOrder.at(-1);
      expect(stdoutWrite.mock.invocationCallOrder[0]).toBeGreaterThan(lastInsertOrder);
    });

    test('reads the files in alphabetical order, whatever the order they were created in', async () => {
      writeTransactionFile('c.json', [transactionJson(3)]);
      writeTransactionFile('a.json', [transactionJson(1)]);
      writeTransactionFile('b.json', [transactionJson(2)]);

      await runDepositProcessingJob();

      expect(storedTransactionIds()).toEqual([transactionId(1), transactionId(2), transactionId(3)]);
    });

    test('orders the names by character code: sample10.json comes before sample2.json', async () => {
      writeTransactionFile('sample2.json', [transactionJson(2)]);
      writeTransactionFile('sample10.json', [transactionJson(10)]);

      await runDepositProcessingJob();

      expect(storedTransactionIds()).toEqual([transactionId(10), transactionId(2)]);
    });

    test('ignores files that are not .json and directories', async () => {
      writeTransactionFile('notes.txt', [transactionJson(1)]);
      writeTransactionFile('upper.JSON', [transactionJson(2)]);
      fs.mkdirSync(path.join(dataDirectory, 'directory.json'));
      writeTransactionFile(path.join('directory.json', 'inside.json'), [transactionJson(3)]);
      writeTransactionFile('valid.json', [transactionJson(4)]);

      await runDepositProcessingJob();

      expect(storedTransactionIds()).toEqual([transactionId(4)]);
    });

    test('prints the report with an empty data directory', async () => {
      await runDepositProcessingJob();

      expect(depositRepository.insertDepositIfAbsent).not.toHaveBeenCalled();
      expect(printedText()).toBe(`${REPORT_LINES.join('\n')}\n`);
    });

    test('tells the service which file each transaction came from', async () => {
      writeTransactionFile('sample1.json', [transactionJson(1)]);

      await runDepositProcessingJob();

      expect(depositRepository.insertDepositIfAbsent.mock.calls[0][1].sourceFileName).toBe('sample1.json');
    });
  });

  describe('bad files never stop the processing', () => {
    test.each([
      ['broken JSON', '{"transactions": ['],
      ['no "transactions" field', '{"transaction_count": 0}'],
      ['"transactions" that is not an array', '{"transactions": {}}'],
      ['empty "transactions"', '{"transactions": []}'],
      ['empty file', ''],
    ])('skips a file with %s and processes the next file', async (caseName, badContent) => {
      writeDataFile('a-bad.json', badContent);
      writeTransactionFile('b-good.json', [transactionJson(1)]);

      await runDepositProcessingJob();

      expect(storedTransactionIds()).toEqual([transactionId(1)]);
      expect(printedText()).toBe(`${REPORT_LINES.join('\n')}\n`);
    });
  });

  describe('unreadable files never stop the processing', () => {
    test('skips a file that cannot be read and processes the next file', async () => {
      writeTransactionFile('a-unreadable.json', [transactionJson(1)]);
      writeTransactionFile('b-good.json', [transactionJson(2)]);
      const fsPromises = require('node:fs/promises');
      const realReadFile = fsPromises.readFile;
      const readFile = jest.spyOn(fsPromises, 'readFile').mockImplementation((filePath, ...rest) => {
        if (String(filePath).endsWith('a-unreadable.json')) {
          return Promise.reject(Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }));
        }
        return realReadFile(filePath, ...rest);
      });

      try {
        await runDepositProcessingJob();
      } finally {
        readFile.mockRestore();
      }

      expect(storedTransactionIds()).toEqual([transactionId(2)]);
      expect(printedText()).toBe(`${REPORT_LINES.join('\n')}\n`);
    });
  });

  describe('bad transactions never stop the processing', () => {
    test('skips an invalid transaction and processes the next one', async () => {
      writeTransactionFile('sample1.json', [
        transactionJson(1, { amount: '0' }),
        transactionJson(2, { id: 'not-a-uuid' }),
        'null',
        transactionJson(4),
      ]);

      await runDepositProcessingJob();

      expect(storedTransactionIds()).toEqual([transactionId(4)]);
      expect(printedText()).toBe(`${REPORT_LINES.join('\n')}\n`);
    });

    test('processes a file even when "transaction_count" differs from the array size', async () => {
      writeDataFile('sample1.json', `{"transaction_count": 3, "transactions": [${transactionJson(1)}]}`);

      await runDepositProcessingJob();

      expect(storedTransactionIds()).toEqual([transactionId(1)]);
    });
  });

  describe('bad data refused by the database (class 22)', () => {
    test('skips that transaction, processes the next ones and prints the report', async () => {
      writeTransactionFile('sample1.json', [transactionJson(1), transactionJson(2), transactionJson(3)]);
      writeTransactionFile('sample2.json', [transactionJson(4)]);
      customerRepository.addDepositToCustomerTotals
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(databaseError('22003'))
        .mockResolvedValue(undefined);

      await expect(runDepositProcessingJob()).resolves.toBeUndefined();

      expect(storedTransactionIds()).toEqual([transactionId(1), transactionId(2), transactionId(3), transactionId(4)]);
      expect(customerRepository.addDepositToCustomerTotals).toHaveBeenCalledTimes(4);
      expect(printedText()).toBe(`${REPORT_LINES.join('\n')}\n`);
    });
  });

  describe('any other error stops the job without printing the report', () => {
    test.each([
      ['a terminated connection', databaseError('57P01')],
      ['a constraint violation', databaseError('23514')],
      ['a network failure', Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })],
      ['an unexpected error', new Error('unexpected')],
    ])('stops at %s', async (caseName, error) => {
      writeTransactionFile('sample1.json', [transactionJson(1), transactionJson(2), transactionJson(3)]);
      writeTransactionFile('sample2.json', [transactionJson(4)]);
      depositRepository.insertDepositIfAbsent.mockResolvedValueOnce(true).mockRejectedValueOnce(error);

      await expect(runDepositProcessingJob()).rejects.toBe(error);

      // Stopped at the second transaction: the third and the next file were never tried.
      expect(storedTransactionIds()).toEqual([transactionId(1), transactionId(2)]);
      expect(stdoutWrite).not.toHaveBeenCalled();
      expect(customerRepository.listCustomerDepositTotals).not.toHaveBeenCalled();
    });

    test('says at which file and transaction it stopped', async () => {
      writeTransactionFile('sample1.json', [transactionJson(1), transactionJson(2)]);
      depositRepository.insertDepositIfAbsent.mockResolvedValueOnce(true).mockRejectedValueOnce(databaseError('57P01'));

      await expect(runDepositProcessingJob()).rejects.toThrow();

      expect(describeCurrentJobPosition()).toBe(`at file sample1.json, transaction #1 (id ${transactionId(2)})`);
    });

    test('stops without report when the report itself cannot be read', async () => {
      writeTransactionFile('sample1.json', [transactionJson(1)]);
      const error = databaseError('57P01');
      customerRepository.listCustomerDepositTotals.mockRejectedValue(error);

      await expect(runDepositProcessingJob()).rejects.toBe(error);

      expect(stdoutWrite).not.toHaveBeenCalled();
      expect(describeCurrentJobPosition()).toBe('after all transaction files, while building the report');
    });

    test('stops without report when the data directory does not exist', async () => {
      fs.rmSync(dataDirectory, { recursive: true });

      try {
        await expect(runDepositProcessingJob()).rejects.toThrow(/ENOENT/);
        expect(stdoutWrite).not.toHaveBeenCalled();
      } finally {
        fs.mkdirSync(dataDirectory);
      }
    });
  });
});
