'use strict';

const mockConnection = { name: 'fake connection' };
jest.mock('../../../src/db/client', () => ({
  runInTransaction: jest.fn((transactionBlock) => transactionBlock(mockConnection)),
}));
jest.mock('../../../src/repositories/customerRepository');
jest.mock('../../../src/repositories/customerAccountRepository');

const { runInTransaction } = require('../../../src/db/client');
const customerRepository = require('../../../src/repositories/customerRepository');
const customerAccountRepository = require('../../../src/repositories/customerAccountRepository');
const { seedKnownCustomers } = require('../../../src/db/seeder');

// Copied by hand from the challenge README, as an independent check of the seed.
const CUSTOMERS_FROM_README = [
  ['Jadzia Dax', [['011000015', '6622085487']]],
  ['James T. Kirk', [['021001208', '0018423486']]],
  ['Jean-Luc Picard', [['021001208', '1691452698']]],
  ['Jonathan Archer', [['011000015', '3572176408']]],
  ['Leonard McCoy', [['011000015', '8149516692']]],
  ['Montgomery Scott', [['011000015', '7438979785']]],
  ['Spock', [['011000015', '1690537988'], ['021001208', '1690537989']]],
  ['Wesley Crusher', [['011000015', '6018423486']]],
];

beforeEach(async () => {
  jest.clearAllMocks();
  await seedKnownCustomers();
});

function seededCustomers() {
  return customerRepository.insertCustomerIfAbsent.mock.calls.map(([, customer]) => customer);
}

function seededAccounts() {
  return customerAccountRepository.insertCustomerAccountIfAbsent.mock.calls.map(([, account]) => account);
}

describe('seedKnownCustomers', () => {
  test('inserts the 8 customers of the README, in the README order, with ids 1 to 8', () => {
    expect(seededCustomers()).toEqual(
      CUSTOMERS_FROM_README.map(([name], index) => ({ customerId: index + 1, name })),
    );
  });

  test('inserts the 9 accounts of the README, each linked to its customer', () => {
    const expectedAccounts = CUSTOMERS_FROM_README.flatMap(([, accounts], index) =>
      accounts.map(([routingNumber, accountNumber]) => ({ routingNumber, accountNumber, customerId: index + 1 })),
    );

    expect(seededAccounts()).toEqual(expectedAccounts);
    expect(seededAccounts()).toHaveLength(9);
  });

  test('links the two accounts of Spock to the same customer', () => {
    const spockAccounts = seededAccounts().filter((account) => account.customerId === 7);

    expect(spockAccounts.map((account) => account.routingNumber)).toEqual(['011000015', '021001208']);
  });

  test('keeps routing and account numbers as text, with their leading zeros', () => {
    for (const { routingNumber, accountNumber } of seededAccounts()) {
      expect(routingNumber).toMatch(/^[0-9]{9}$/);
      expect(accountNumber).toMatch(/^[0-9]{10}$/);
    }
    expect(seededAccounts()).toContainEqual({ routingNumber: '021001208', accountNumber: '0018423486', customerId: 2 });
  });

  test('inserts each customer before its accounts, all in one database transaction', () => {
    expect(runInTransaction).toHaveBeenCalledTimes(1);
    const customerOrders = customerRepository.insertCustomerIfAbsent.mock.invocationCallOrder;
    const accountOrders = customerAccountRepository.insertCustomerAccountIfAbsent.mock.invocationCallOrder;
    expect(customerOrders[0]).toBeLessThan(accountOrders[0]);
    for (const [connection] of customerRepository.insertCustomerIfAbsent.mock.calls) {
      expect(connection).toBe(mockConnection);
    }
    for (const [connection] of customerAccountRepository.insertCustomerAccountIfAbsent.mock.calls) {
      expect(connection).toBe(mockConnection);
    }
  });
});
