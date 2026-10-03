'use strict';

// No database: the transaction runner hands the block a fake connection and
// the repositories are fakes whose answers each test decides.
const mockConnection = { name: 'fake connection' };
jest.mock('../../../src/db/client', () => ({
  runInTransaction: jest.fn((transactionBlock) => transactionBlock(mockConnection)),
  isDataException: jest.requireActual('../../../src/db/client').isDataException,
}));
jest.mock('../../../src/repositories/customerRepository');
jest.mock('../../../src/repositories/customerAccountRepository');
jest.mock('../../../src/repositories/depositRepository');

const { runInTransaction } = require('../../../src/db/client');
const customerRepository = require('../../../src/repositories/customerRepository');
const customerAccountRepository = require('../../../src/repositories/customerAccountRepository');
const depositRepository = require('../../../src/repositories/depositRepository');
const { DepositOutcome, processTransaction, isSkippedOutcome } = require('../../../src/services/depositService');

const SOURCE_FILE_NAME = 'sample1.json';
const KNOWN_CUSTOMER_ID = 7;

function buildTransaction(overrides = {}) {
  return {
    transactionId: '1e471dca-dcb2-47f8-8077-63659f2274ee',
    destinationAccount: { routingNumber: '011000015', accountNumber: '1690537988' },
    originAccount: { routingNumber: '130495809', accountNumber: '9834891235' },
    amountCents: 72460n,
    currency: 'USD',
    ...overrides,
  };
}

function databaseError(sqlState) {
  return Object.assign(new Error(`database error ${sqlState}`), { code: sqlState });
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default scenario: known routing, known customer, id not stored yet.
  customerAccountRepository.isKnownRoutingNumber.mockResolvedValue(true);
  customerAccountRepository.findCustomerIdByAccount.mockResolvedValue(KNOWN_CUSTOMER_ID);
  depositRepository.insertDepositIfAbsent.mockResolvedValue(true);
  customerRepository.addDepositToCustomerTotals.mockResolvedValue(undefined);
});

describe('processTransaction', () => {
  describe('origin equal to destination', () => {
    test('skips the transaction without touching the database', async () => {
      const sameAccount = { routingNumber: '011000015', accountNumber: '1690537988' };
      const transaction = buildTransaction({ destinationAccount: sameAccount, originAccount: { ...sameAccount } });

      const outcome = await processTransaction(transaction, SOURCE_FILE_NAME);

      expect(outcome).toBe(DepositOutcome.SKIPPED_SAME_ORIGIN_AND_DESTINATION);
      expect(runInTransaction).not.toHaveBeenCalled();
      expect(depositRepository.insertDepositIfAbsent).not.toHaveBeenCalled();
      expect(customerRepository.addDepositToCustomerTotals).not.toHaveBeenCalled();
    });

    test('the same account number in another bank is a different account', async () => {
      const transaction = buildTransaction({
        destinationAccount: { routingNumber: '011000015', accountNumber: '1690537988' },
        originAccount: { routingNumber: '021001208', accountNumber: '1690537988' },
      });

      expect(await processTransaction(transaction, SOURCE_FILE_NAME)).toBe(DepositOutcome.CREDITED_TO_CUSTOMER);
    });

    test('another account number in the same bank is a different account', async () => {
      const transaction = buildTransaction({
        destinationAccount: { routingNumber: '011000015', accountNumber: '1690537988' },
        originAccount: { routingNumber: '011000015', accountNumber: '1690537989' },
      });

      expect(await processTransaction(transaction, SOURCE_FILE_NAME)).toBe(DepositOutcome.CREDITED_TO_CUSTOMER);
    });
  });

  describe('destination routing number that is not known', () => {
    test('skips the transaction and stores nothing', async () => {
      customerAccountRepository.isKnownRoutingNumber.mockResolvedValue(false);

      const outcome = await processTransaction(buildTransaction(), SOURCE_FILE_NAME);

      expect(outcome).toBe(DepositOutcome.SKIPPED_UNKNOWN_ROUTING_NUMBER);
      expect(customerAccountRepository.isKnownRoutingNumber).toHaveBeenCalledWith(mockConnection, '011000015');
      expect(depositRepository.insertDepositIfAbsent).not.toHaveBeenCalled();
      expect(customerRepository.addDepositToCustomerTotals).not.toHaveBeenCalled();
    });
  });

  describe('duplicate id', () => {
    test('skips the transaction and does not credit the customer again', async () => {
      depositRepository.insertDepositIfAbsent.mockResolvedValue(false);

      const outcome = await processTransaction(buildTransaction(), SOURCE_FILE_NAME);

      expect(outcome).toBe(DepositOutcome.SKIPPED_ALREADY_PROCESSED);
      expect(customerRepository.addDepositToCustomerTotals).not.toHaveBeenCalled();
    });

    test('a duplicate without known customer is also skipped', async () => {
      customerAccountRepository.findCustomerIdByAccount.mockResolvedValue(null);
      depositRepository.insertDepositIfAbsent.mockResolvedValue(false);

      expect(await processTransaction(buildTransaction(), SOURCE_FILE_NAME)).toBe(DepositOutcome.SKIPPED_ALREADY_PROCESSED);
    });
  });

  describe('destination account of a known customer', () => {
    test('stores the deposit with the customer id', async () => {
      const transaction = buildTransaction();

      const outcome = await processTransaction(transaction, SOURCE_FILE_NAME);

      expect(outcome).toBe(DepositOutcome.CREDITED_TO_CUSTOMER);
      expect(customerAccountRepository.findCustomerIdByAccount).toHaveBeenCalledWith(mockConnection, transaction.destinationAccount);
      expect(depositRepository.insertDepositIfAbsent).toHaveBeenCalledWith(mockConnection, {
        transactionId: transaction.transactionId,
        customerId: KNOWN_CUSTOMER_ID,
        destinationAccount: transaction.destinationAccount,
        originAccount: transaction.originAccount,
        amountCents: 72460n,
        currency: 'USD',
        sourceFileName: SOURCE_FILE_NAME,
      });
    });

    test('adds the amount and the count to the totals of that customer', async () => {
      await processTransaction(buildTransaction(), SOURCE_FILE_NAME);

      expect(customerRepository.addDepositToCustomerTotals).toHaveBeenCalledTimes(1);
      expect(customerRepository.addDepositToCustomerTotals).toHaveBeenCalledWith(mockConnection, {
        customerId: KNOWN_CUSTOMER_ID,
        amountCents: 72460n,
      });
    });

    test('writes the deposit and the totals in the same database transaction', async () => {
      await processTransaction(buildTransaction(), SOURCE_FILE_NAME);

      expect(runInTransaction).toHaveBeenCalledTimes(1);
      expect(depositRepository.insertDepositIfAbsent.mock.calls[0][0]).toBe(mockConnection);
      expect(customerRepository.addDepositToCustomerTotals.mock.calls[0][0]).toBe(mockConnection);
    });

    test('inserts the deposit before updating the totals', async () => {
      await processTransaction(buildTransaction(), SOURCE_FILE_NAME);

      const insertOrder = depositRepository.insertDepositIfAbsent.mock.invocationCallOrder[0];
      const totalsOrder = customerRepository.addDepositToCustomerTotals.mock.invocationCallOrder[0];
      expect(insertOrder).toBeLessThan(totalsOrder);
    });
  });

  describe('destination account without known customer', () => {
    beforeEach(() => {
      customerAccountRepository.findCustomerIdByAccount.mockResolvedValue(null);
    });

    test('stores the deposit with a null customer id', async () => {
      const outcome = await processTransaction(buildTransaction(), SOURCE_FILE_NAME);

      expect(outcome).toBe(DepositOutcome.RECORDED_WITHOUT_KNOWN_CUSTOMER);
      expect(depositRepository.insertDepositIfAbsent).toHaveBeenCalledWith(
        mockConnection,
        expect.objectContaining({ customerId: null, amountCents: 72460n }),
      );
    });

    test('does not change the totals of any customer', async () => {
      await processTransaction(buildTransaction(), SOURCE_FILE_NAME);

      expect(customerRepository.addDepositToCustomerTotals).not.toHaveBeenCalled();
    });
  });

  describe('database errors', () => {
    test('skips only this transaction when the database refuses its data (class 22)', async () => {
      customerRepository.addDepositToCustomerTotals.mockRejectedValue(databaseError('22003'));

      const outcome = await processTransaction(buildTransaction(), SOURCE_FILE_NAME);

      expect(outcome).toBe(DepositOutcome.SKIPPED_REJECTED_BY_DATABASE);
    });

    test('skips only this transaction when the insert is refused by a class 22 error', async () => {
      depositRepository.insertDepositIfAbsent.mockRejectedValue(databaseError('22021'));

      expect(await processTransaction(buildTransaction(), SOURCE_FILE_NAME)).toBe(DepositOutcome.SKIPPED_REJECTED_BY_DATABASE);
    });

    test.each([
      ['a constraint violation', databaseError('23514')],
      ['a terminated connection', databaseError('57P01')],
      ['a network failure', Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })],
      ['an unexpected error', new Error('unexpected')],
    ])('lets %s go up, so the job stops', async (caseName, error) => {
      depositRepository.insertDepositIfAbsent.mockRejectedValue(error);

      await expect(processTransaction(buildTransaction(), SOURCE_FILE_NAME)).rejects.toBe(error);
    });
  });
});

describe('isSkippedOutcome', () => {
  test.each([
    DepositOutcome.SKIPPED_SAME_ORIGIN_AND_DESTINATION,
    DepositOutcome.SKIPPED_UNKNOWN_ROUTING_NUMBER,
    DepositOutcome.SKIPPED_ALREADY_PROCESSED,
    DepositOutcome.SKIPPED_REJECTED_BY_DATABASE,
  ])('is true for "%s"', (outcome) => {
    expect(isSkippedOutcome(outcome)).toBe(true);
  });

  test.each([DepositOutcome.CREDITED_TO_CUSTOMER, DepositOutcome.RECORDED_WITHOUT_KNOWN_CUSTOMER])(
    'is false for "%s"',
    (outcome) => {
      expect(isSkippedOutcome(outcome)).toBe(false);
    },
  );
});
