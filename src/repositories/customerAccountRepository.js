'use strict';

// SQL for the `customer_accounts` table. Every function receives the connection
// to run on, so the caller decides which transaction the query belongs to.

async function insertCustomerAccountIfAbsent(connection, { routingNumber, accountNumber, customerId }) {
  await connection.query(
    `INSERT INTO customer_accounts (routing_number, account_number, customer_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (routing_number, account_number) DO NOTHING`,
    [routingNumber, accountNumber, customerId],
  );
}

/**
 * Returns the customer_id that owns the account, or null when the pair
 * routing number + account number is not a known customer account.
 */
async function findCustomerIdByAccount(connection, { routingNumber, accountNumber }) {
  const { rows } = await connection.query(
    `SELECT customer_id AS "customerId"
       FROM customer_accounts
      WHERE routing_number = $1
        AND account_number = $2`,
    [routingNumber, accountNumber],
  );
  return rows.length === 0 ? null : rows[0].customerId;
}

/**
 * True when at least one known customer account uses the routing number.
 */
async function isKnownRoutingNumber(connection, routingNumber) {
  const { rows } = await connection.query(
    `SELECT EXISTS (
       SELECT 1 FROM customer_accounts WHERE routing_number = $1
     ) AS "isKnown"`,
    [routingNumber],
  );
  return rows[0].isKnown;
}

module.exports = { insertCustomerAccountIfAbsent, findCustomerIdByAccount, isKnownRoutingNumber };
