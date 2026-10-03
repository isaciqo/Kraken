'use strict';

// SQL for the `customers` table. Every function receives the connection to run
// on, so the caller decides which transaction the query belongs to.

async function insertCustomerIfAbsent(connection, { customerId, name }) {
  await connection.query(
    `INSERT INTO customers (customer_id, name)
     VALUES ($1, $2)
     ON CONFLICT (customer_id) DO NOTHING`,
    [customerId, name],
  );
}

/**
 * Adds one deposit to the customer's running totals. The increment happens
 * inside the UPDATE itself, so concurrent deposits never overwrite each other.
 */
async function addDepositToCustomerTotals(connection, { customerId, amountCents }) {
  await connection.query(
    `UPDATE customers
        SET deposit_count = deposit_count + 1,
            total_deposited_cents = total_deposited_cents + $2
      WHERE customer_id = $1`,
    [customerId, String(amountCents)],
  );
}

/**
 * Returns [{ name, depositCount, totalDepositedCents }] in customer_id order.
 * BIGINT columns come back as strings.
 */
async function listCustomerDepositTotals(connection) {
  const { rows } = await connection.query(
    `SELECT name,
            deposit_count AS "depositCount",
            total_deposited_cents AS "totalDepositedCents"
       FROM customers
      ORDER BY customer_id`,
  );
  return rows;
}

module.exports = { insertCustomerIfAbsent, addDepositToCustomerTotals, listCustomerDepositTotals };
