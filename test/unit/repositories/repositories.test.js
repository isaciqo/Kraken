'use strict';

// The repositories only hold SQL, so these tests cannot prove the SQL is
// right: that is the job of the docker-compose runs against a real database.
// What they check is what does not need a database: which table each
// statement targets, the order of the parameters and how the result is read.

const customerRepository = require('../../../src/repositories/customerRepository');
const customerAccountRepository = require('../../../src/repositories/customerAccountRepository');
const depositRepository = require('../../../src/repositories/depositRepository');

function fakeConnection(queryResult = { rows: [], rowCount: 0 }) {
  return { query: jest.fn().mockResolvedValue(queryResult) };
}

function executedQuery(connection) {
  expect(connection.query).toHaveBeenCalledTimes(1);
  const [statement, parameters] = connection.query.mock.calls[0];
  return { statement: statement.replace(/\s+/g, ' ').trim(), parameters };
}

describe('customerRepository', () => {
  test('insertCustomerIfAbsent inserts the id and the name, skipping an existing customer', async () => {
    const connection = fakeConnection();

    await customerRepository.insertCustomerIfAbsent(connection, { customerId: 7, name: 'Spock' });

    const { statement, parameters } = executedQuery(connection);
    expect(statement).toMatch(/^INSERT INTO customers \(customer_id, name\)/);
    expect(statement).toContain('ON CONFLICT (customer_id) DO NOTHING');
    expect(parameters).toEqual([7, 'Spock']);
  });

  test('addDepositToCustomerTotals increments inside the UPDATE and sends the cents as text', async () => {
    const connection = fakeConnection();

    await customerRepository.addDepositToCustomerTotals(connection, { customerId: 7, amountCents: 9007199254740991n });

    const { statement, parameters } = executedQuery(connection);
    expect(statement).toContain('deposit_count = deposit_count + 1');
    expect(statement).toContain('total_deposited_cents = total_deposited_cents + $2');
    expect(statement).toContain('WHERE customer_id = $1');
    expect(parameters).toEqual([7, '9007199254740991']);
  });

  test('listCustomerDepositTotals returns the rows ordered by customer id', async () => {
    const rows = [{ name: 'Jadzia Dax', depositCount: '6', totalDepositedCents: '316073' }];
    const connection = fakeConnection({ rows });

    const customerTotals = await customerRepository.listCustomerDepositTotals(connection);

    expect(customerTotals).toBe(rows);
    expect(executedQuery(connection).statement).toMatch(/ORDER BY customer_id$/);
  });
});

describe('customerAccountRepository', () => {
  test('insertCustomerAccountIfAbsent sends routing, account and customer in this order', async () => {
    const connection = fakeConnection();

    await customerAccountRepository.insertCustomerAccountIfAbsent(connection, {
      routingNumber: '021001208',
      accountNumber: '0018423486',
      customerId: 2,
    });

    const { statement, parameters } = executedQuery(connection);
    expect(statement).toMatch(/^INSERT INTO customer_accounts \(routing_number, account_number, customer_id\)/);
    expect(statement).toContain('ON CONFLICT (routing_number, account_number) DO NOTHING');
    expect(parameters).toEqual(['021001208', '0018423486', 2]);
  });

  test('findCustomerIdByAccount searches by the pair routing + account and returns the customer id', async () => {
    const connection = fakeConnection({ rows: [{ customerId: 2 }] });

    const customerId = await customerAccountRepository.findCustomerIdByAccount(connection, {
      routingNumber: '021001208',
      accountNumber: '0018423486',
    });

    const { statement, parameters } = executedQuery(connection);
    expect(customerId).toBe(2);
    expect(statement).toContain('WHERE routing_number = $1 AND account_number = $2');
    expect(parameters).toEqual(['021001208', '0018423486']);
  });

  test('findCustomerIdByAccount returns null when the account belongs to no customer', async () => {
    const connection = fakeConnection({ rows: [] });

    const customerId = await customerAccountRepository.findCustomerIdByAccount(connection, {
      routingNumber: '021001208',
      accountNumber: '8149516692',
    });

    expect(customerId).toBeNull();
  });

  test.each([true, false])('isKnownRoutingNumber returns %s as answered by the database', async (isKnown) => {
    const connection = fakeConnection({ rows: [{ isKnown }] });

    const result = await customerAccountRepository.isKnownRoutingNumber(connection, '011000015');

    expect(result).toBe(isKnown);
    expect(executedQuery(connection).parameters).toEqual(['011000015']);
  });
});

describe('depositRepository', () => {
  const deposit = {
    transactionId: '1e471dca-dcb2-47f8-8077-63659f2274ee',
    customerId: 4,
    destinationAccount: { routingNumber: '011000015', accountNumber: '3572176408' },
    originAccount: { routingNumber: '130495809', accountNumber: '9834891235' },
    amountCents: 72460n,
    currency: 'USD',
    sourceFileName: 'sample1.json',
  };

  test('insertDepositIfAbsent sends every column in the order of the statement', async () => {
    const connection = fakeConnection({ rowCount: 1 });

    await depositRepository.insertDepositIfAbsent(connection, deposit);

    const { statement, parameters } = executedQuery(connection);
    expect(statement).toContain(
      'INSERT INTO deposits ( transaction_id, customer_id, to_routing_number, to_account_number, from_routing_number, from_account_number, amount_cents, currency, source_file )',
    );
    expect(statement).toContain('ON CONFLICT (transaction_id) DO NOTHING');
    expect(parameters).toEqual([
      '1e471dca-dcb2-47f8-8077-63659f2274ee',
      4,
      '011000015',
      '3572176408',
      '130495809',
      '9834891235',
      '72460',
      'USD',
      'sample1.json',
    ]);
  });

  test('insertDepositIfAbsent returns true when the row was inserted', async () => {
    expect(await depositRepository.insertDepositIfAbsent(fakeConnection({ rowCount: 1 }), deposit)).toBe(true);
  });

  test('insertDepositIfAbsent returns false when the id was already stored', async () => {
    expect(await depositRepository.insertDepositIfAbsent(fakeConnection({ rowCount: 0 }), deposit)).toBe(false);
  });

  test('insertDepositIfAbsent sends a null customer for a deposit without known customer', async () => {
    const connection = fakeConnection({ rowCount: 1 });

    await depositRepository.insertDepositIfAbsent(connection, { ...deposit, customerId: null });

    expect(executedQuery(connection).parameters[1]).toBeNull();
  });

  test('getTotalsOfDepositsWithoutCustomer counts only the deposits without customer', async () => {
    const totals = { depositCount: '4', totalDepositedCents: '178667' };
    const connection = fakeConnection({ rows: [totals] });

    expect(await depositRepository.getTotalsOfDepositsWithoutCustomer(connection)).toBe(totals);
    expect(executedQuery(connection).statement).toMatch(/FROM deposits WHERE customer_id IS NULL$/);
  });

  test('getSmallestAndLargestDepositCents looks at every deposit, with or without customer', async () => {
    const smallestAndLargest = { smallestDepositCents: '14067', largestDepositCents: '98853' };
    const connection = fakeConnection({ rows: [smallestAndLargest] });

    expect(await depositRepository.getSmallestAndLargestDepositCents(connection)).toBe(smallestAndLargest);
    const { statement } = executedQuery(connection);
    expect(statement).toMatch(/FROM deposits$/);
    expect(statement).not.toContain('WHERE');
  });
});
