'use strict';

const { runInTransaction } = require('./client');
const customerRepository = require('../repositories/customerRepository');
const customerAccountRepository = require('../repositories/customerAccountRepository');

// Known customer depository accounts, as listed in the challenge README.
// customer_id follows the README order, which is also the report order.
const KNOWN_CUSTOMERS = [
  {
    customerId: 1,
    name: 'Jadzia Dax',
    accounts: [{ routingNumber: '011000015', accountNumber: '6622085487' }],
  },
  {
    customerId: 2,
    name: 'James T. Kirk',
    accounts: [{ routingNumber: '021001208', accountNumber: '0018423486' }],
  },
  {
    customerId: 3,
    name: 'Jean-Luc Picard',
    accounts: [{ routingNumber: '021001208', accountNumber: '1691452698' }],
  },
  {
    customerId: 4,
    name: 'Jonathan Archer',
    accounts: [{ routingNumber: '011000015', accountNumber: '3572176408' }],
  },
  {
    customerId: 5,
    name: 'Leonard McCoy',
    accounts: [{ routingNumber: '011000015', accountNumber: '8149516692' }],
  },
  {
    customerId: 6,
    name: 'Montgomery Scott',
    accounts: [{ routingNumber: '011000015', accountNumber: '7438979785' }],
  },
  {
    customerId: 7,
    name: 'Spock',
    accounts: [
      { routingNumber: '011000015', accountNumber: '1690537988' },
      { routingNumber: '021001208', accountNumber: '1690537989' },
    ],
  },
  {
    customerId: 8,
    name: 'Wesley Crusher',
    accounts: [{ routingNumber: '011000015', accountNumber: '6018423486' }],
  },
];

/**
 * Inserts the known customers and their accounts. Runs in one transaction and
 * skips rows that already exist.
 */
async function seedKnownCustomers() {
  await runInTransaction(async (connection) => {
    for (const { customerId, name, accounts } of KNOWN_CUSTOMERS) {
      await customerRepository.insertCustomerIfAbsent(connection, { customerId, name });

      for (const { routingNumber, accountNumber } of accounts) {
        await customerAccountRepository.insertCustomerAccountIfAbsent(connection, {
          routingNumber,
          accountNumber,
          customerId,
        });
      }
    }
  });
}

module.exports = { seedKnownCustomers };
