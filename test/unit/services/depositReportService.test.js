'use strict';

const mockConnection = { name: 'fake connection' };
jest.mock('../../../src/db/client', () => ({
  runInTransaction: jest.fn((transactionBlock) => transactionBlock(mockConnection)),
}));
jest.mock('../../../src/repositories/customerRepository');
jest.mock('../../../src/repositories/depositRepository');

const { runInTransaction } = require('../../../src/db/client');
const customerRepository = require('../../../src/repositories/customerRepository');
const depositRepository = require('../../../src/repositories/depositRepository');
const { buildDepositReportLines } = require('../../../src/services/depositReportService');

// What the repositories return for the two sample files. BIGINT values come
// from PostgreSQL as text.
const SAMPLE_CUSTOMER_TOTALS = [
  { name: 'Jadzia Dax', depositCount: '6', totalDepositedCents: '316073' },
  { name: 'James T. Kirk', depositCount: '5', totalDepositedCents: '208789' },
  { name: 'Jean-Luc Picard', depositCount: '3', totalDepositedCents: '157355' },
  { name: 'Jonathan Archer', depositCount: '7', totalDepositedCents: '376339' },
  { name: 'Leonard McCoy', depositCount: '3', totalDepositedCents: '83965' },
  { name: 'Montgomery Scott', depositCount: '4', totalDepositedCents: '236065' },
  { name: 'Spock', depositCount: '10', totalDepositedCents: '531281' },
  { name: 'Wesley Crusher', depositCount: '3', totalDepositedCents: '169419' },
];

beforeEach(() => {
  jest.clearAllMocks();
  customerRepository.listCustomerDepositTotals.mockResolvedValue(SAMPLE_CUSTOMER_TOTALS);
  depositRepository.getTotalsOfDepositsWithoutCustomer.mockResolvedValue({ depositCount: '4', totalDepositedCents: '178667' });
  depositRepository.getSmallestAndLargestDepositCents.mockResolvedValue({
    smallestDepositCents: '14067',
    largestDepositCents: '98853',
  });
});

describe('buildDepositReportLines', () => {
  test('builds the 11 lines in the exact format of the challenge README', async () => {
    expect(await buildDepositReportLines()).toEqual([
      'Deposited for Jadzia Dax: count=6 sum=3160.73 USD',
      'Deposited for James T. Kirk: count=5 sum=2087.89 USD',
      'Deposited for Jean-Luc Picard: count=3 sum=1573.55 USD',
      'Deposited for Jonathan Archer: count=7 sum=3763.39 USD',
      'Deposited for Leonard McCoy: count=3 sum=839.65 USD',
      'Deposited for Montgomery Scott: count=4 sum=2360.65 USD',
      'Deposited for Spock: count=10 sum=5312.81 USD',
      'Deposited for Wesley Crusher: count=3 sum=1694.19 USD',
      'Deposited without known user: count=4 sum=1786.67 USD',
      'Smallest valid deposit: 140.67 USD',
      'Largest valid deposit: 988.53 USD',
    ]);
  });

  test('keeps the customers in the order returned by the repository', async () => {
    customerRepository.listCustomerDepositTotals.mockResolvedValue([
      { name: 'Spock', depositCount: '1', totalDepositedCents: '100' },
      { name: 'Jadzia Dax', depositCount: '1', totalDepositedCents: '100' },
    ]);

    const reportLines = await buildDepositReportLines();

    expect(reportLines[0]).toMatch(/^Deposited for Spock:/);
    expect(reportLines[1]).toMatch(/^Deposited for Jadzia Dax:/);
  });

  test('prints count=0 sum=0.00 for a customer without deposits', async () => {
    customerRepository.listCustomerDepositTotals.mockResolvedValue([
      { name: 'Leonard McCoy', depositCount: '0', totalDepositedCents: '0' },
    ]);

    expect((await buildDepositReportLines())[0]).toBe('Deposited for Leonard McCoy: count=0 sum=0.00 USD');
  });

  test('prints 0.00 for the smallest and the largest deposit when there is no deposit', async () => {
    depositRepository.getTotalsOfDepositsWithoutCustomer.mockResolvedValue({ depositCount: '0', totalDepositedCents: '0' });
    depositRepository.getSmallestAndLargestDepositCents.mockResolvedValue({
      smallestDepositCents: null,
      largestDepositCents: null,
    });

    const reportLines = await buildDepositReportLines();

    expect(reportLines.slice(-3)).toEqual([
      'Deposited without known user: count=0 sum=0.00 USD',
      'Smallest valid deposit: 0.00 USD',
      'Largest valid deposit: 0.00 USD',
    ]);
  });

  test('formats sums beyond the precision of a floating point number', async () => {
    customerRepository.listCustomerDepositTotals.mockResolvedValue([
      { name: 'Wesley Crusher', depositCount: '2', totalDepositedCents: '9007199254741000' },
    ]);
    depositRepository.getTotalsOfDepositsWithoutCustomer.mockResolvedValue({
      depositCount: '2',
      totalDepositedCents: '10000000000000000000',
    });

    const reportLines = await buildDepositReportLines();

    expect(reportLines[0]).toBe('Deposited for Wesley Crusher: count=2 sum=90071992547410.00 USD');
    expect(reportLines[1]).toBe('Deposited without known user: count=2 sum=100000000000000000.00 USD');
  });

  test('reads everything in one REPEATABLE READ transaction, on the same connection', async () => {
    await buildDepositReportLines();

    expect(runInTransaction).toHaveBeenCalledTimes(1);
    expect(runInTransaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'REPEATABLE READ' });
    expect(customerRepository.listCustomerDepositTotals).toHaveBeenCalledWith(mockConnection);
    expect(depositRepository.getTotalsOfDepositsWithoutCustomer).toHaveBeenCalledWith(mockConnection);
    expect(depositRepository.getSmallestAndLargestDepositCents).toHaveBeenCalledWith(mockConnection);
  });
});
