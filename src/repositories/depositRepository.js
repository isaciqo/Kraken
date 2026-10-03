'use strict';

// SQL for the `deposits` table. Every function receives the connection to run
// on, so the caller decides which transaction the query belongs to.

/**
 * Inserts the deposit unless a deposit with the same transaction id already
 * exists. Returns true when the row was inserted, false when the id was
 * already there. The primary key makes the check and the insert one atomic
 * step, so two concurrent runs can never both insert the same transaction.
 */
async function insertDepositIfAbsent(connection, deposit) {
  const { rowCount } = await connection.query(
    `INSERT INTO deposits (
       transaction_id, customer_id,
       to_routing_number, to_account_number,
       from_routing_number, from_account_number,
       amount_cents, currency, source_file
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (transaction_id) DO NOTHING`,
    [
      deposit.transactionId,
      deposit.customerId,
      deposit.destinationAccount.routingNumber,
      deposit.destinationAccount.accountNumber,
      deposit.originAccount.routingNumber,
      deposit.originAccount.accountNumber,
      String(deposit.amountCents),
      deposit.currency,
      deposit.sourceFileName,
    ],
  );
  return rowCount === 1;
}

/**
 * Count and sum of the deposits whose destination is not a known customer
 * account. Returns { depositCount, totalDepositedCents } as strings.
 */
async function getTotalsOfDepositsWithoutCustomer(connection) {
  const { rows } = await connection.query(
    `SELECT COUNT(*) AS "depositCount",
            COALESCE(SUM(amount_cents), 0) AS "totalDepositedCents"
       FROM deposits
      WHERE customer_id IS NULL`,
  );
  return rows[0];
}

/**
 * Smallest and largest amount among all deposits. Both are null when the
 * table is empty.
 */
async function getSmallestAndLargestDepositCents(connection) {
  const { rows } = await connection.query(
    `SELECT MIN(amount_cents) AS "smallestDepositCents",
            MAX(amount_cents) AS "largestDepositCents"
       FROM deposits`,
  );
  return rows[0];
}

module.exports = {
  insertDepositIfAbsent,
  getTotalsOfDepositsWithoutCustomer,
  getSmallestAndLargestDepositCents,
};
