'use strict';

// Builds the deposit report from what is stored in the database.

const { runInTransaction } = require('../db/client');
const customerRepository = require('../repositories/customerRepository');
const depositRepository = require('../repositories/depositRepository');
const { formatCentsAsDecimalText } = require('../helpers/money');

const CURRENCY = 'USD';

// Amount printed for the smallest and largest deposit when there is no deposit.
const NO_DEPOSIT_AMOUNT_CENTS = 0n;

/**
 * Returns the report lines: one per known customer, one for the deposits
 * without known customer, then the smallest and the largest valid deposit.
 *
 * Every number is read from the database, in one REPEATABLE READ transaction,
 * so all lines describe the same snapshot.
 */
async function buildDepositReportLines() {
  const { customerTotals, totalsWithoutCustomer, smallestAndLargest } = await runInTransaction(
    async (connection) => ({
      customerTotals: await customerRepository.listCustomerDepositTotals(connection),
      totalsWithoutCustomer: await depositRepository.getTotalsOfDepositsWithoutCustomer(connection),
      smallestAndLargest: await depositRepository.getSmallestAndLargestDepositCents(connection),
    }),
    { isolationLevel: 'REPEATABLE READ' },
  );

  const customerLines = customerTotals.map(
    ({ name, depositCount, totalDepositedCents }) =>
      `Deposited for ${name}: count=${depositCount} sum=${formatCentsAsDecimalText(totalDepositedCents)} ${CURRENCY}`,
  );

  const smallestDepositCents = smallestAndLargest.smallestDepositCents ?? NO_DEPOSIT_AMOUNT_CENTS;
  const largestDepositCents = smallestAndLargest.largestDepositCents ?? NO_DEPOSIT_AMOUNT_CENTS;

  return [
    ...customerLines,
    `Deposited without known user: count=${totalsWithoutCustomer.depositCount} sum=${formatCentsAsDecimalText(totalsWithoutCustomer.totalDepositedCents)} ${CURRENCY}`,
    `Smallest valid deposit: ${formatCentsAsDecimalText(smallestDepositCents)} ${CURRENCY}`,
    `Largest valid deposit: ${formatCentsAsDecimalText(largestDepositCents)} ${CURRENCY}`,
  ];
}

module.exports = { buildDepositReportLines };
