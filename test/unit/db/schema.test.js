'use strict';

const mockConnection = { query: jest.fn() };
jest.mock('../../../src/db/client', () => ({
  runInTransaction: jest.fn((transactionBlock) => transactionBlock(mockConnection)),
}));

const { runInTransaction } = require('../../../src/db/client');
const { createTables, emptyTables } = require('../../../src/db/schema');

function executedStatements() {
  return mockConnection.query.mock.calls.map(([statement]) => statement);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockConnection.query.mockResolvedValue({ rows: [] });
});

describe('createTables', () => {
  test('runs the real .sql files in file name order and returns their names', async () => {
    const schemaFileNames = await createTables();

    expect(schemaFileNames).toEqual(['001_customers.sql', '002_customer_accounts.sql', '003_deposits.sql']);
  });

  test('takes the advisory lock first, then creates customers, accounts and deposits', async () => {
    await createTables();

    const [lockStatement, ...schemaStatements] = executedStatements();
    expect(lockStatement).toBe('SELECT pg_advisory_xact_lock($1)');
    expect(schemaStatements).toHaveLength(3);
    expect(schemaStatements[0]).toContain('CREATE TABLE IF NOT EXISTS customers');
    expect(schemaStatements[1]).toContain('CREATE TABLE IF NOT EXISTS customer_accounts');
    expect(schemaStatements[2]).toContain('CREATE TABLE IF NOT EXISTS deposits');
  });

  test('every CREATE statement can run again without failing (IF NOT EXISTS)', async () => {
    await createTables();

    const createStatements = executedStatements().join('\n').match(/CREATE (TABLE|INDEX)[^\n]*/g);
    expect(createStatements.length).toBeGreaterThanOrEqual(3);
    for (const createStatement of createStatements) {
      expect(createStatement).toContain('IF NOT EXISTS');
    }
  });

  test('runs everything in one database transaction', async () => {
    await createTables();

    expect(runInTransaction).toHaveBeenCalledTimes(1);
  });
});

describe('emptyTables', () => {
  test('takes the advisory lock and truncates the three tables in one statement', async () => {
    await emptyTables();

    expect(runInTransaction).toHaveBeenCalledTimes(1);
    expect(executedStatements()).toEqual([
      'SELECT pg_advisory_xact_lock($1)',
      'TRUNCATE deposits, customer_accounts, customers',
    ]);
  });

  test('uses the same lock as the table creation', async () => {
    await createTables();
    await emptyTables();

    const lockKeys = mockConnection.query.mock.calls
      .filter(([statement]) => statement === 'SELECT pg_advisory_xact_lock($1)')
      .map(([, parameters]) => parameters[0]);
    expect(lockKeys).toHaveLength(2);
    expect(lockKeys[0]).toBe(lockKeys[1]);
  });
});
