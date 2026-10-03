'use strict';

// Business rules for turning a structurally valid transaction into a deposit.
// Services decide the rules and call the repositories; they never write SQL.

const { runInTransaction, isDataException } = require('../db/client');
const customerRepository = require('../repositories/customerRepository');
const customerAccountRepository = require('../repositories/customerAccountRepository');
const depositRepository = require('../repositories/depositRepository');

const DepositOutcome = Object.freeze({
  CREDITED_TO_CUSTOMER: 'credited to customer',
  RECORDED_WITHOUT_KNOWN_CUSTOMER: 'recorded without known customer',
  SKIPPED_SAME_ORIGIN_AND_DESTINATION: 'skipped: origin and destination are the same account',
  SKIPPED_UNKNOWN_ROUTING_NUMBER: 'skipped: destination routing number is not known',
  SKIPPED_ALREADY_PROCESSED: 'skipped: transaction id was already processed',
  SKIPPED_REJECTED_BY_DATABASE: 'skipped: the database rejected the data of this transaction',
});

function isSameAccount(firstAccount, secondAccount) {
  return (
    firstAccount.routingNumber === secondAccount.routingNumber &&
    firstAccount.accountNumber === secondAccount.accountNumber
  );
}

/**
 * Applies the business rules to one structurally valid transaction and, when
 * it is a valid deposit, stores it. Returns a DepositOutcome.
 *
 * The deposit row and the customer's running totals are written in the SAME
 * database transaction: either both are stored or neither is.
 */
async function processTransaction(transaction, sourceFileName) {
  const { destinationAccount, originAccount } = transaction;

  if (isSameAccount(destinationAccount, originAccount)) {
    return DepositOutcome.SKIPPED_SAME_ORIGIN_AND_DESTINATION;
  }

  try {
    return await storeDepositAndCreditCustomer(transaction, sourceFileName);
  } catch (error) {
    // The database refused this transaction's data (for example, the
    // customer's total would no longer fit the column). The database
    // transaction was rolled back, so nothing of it was stored: only this
    // transaction is skipped. Any other error is an infrastructure failure
    // and stops the job.
    if (isDataException(error)) {
      return DepositOutcome.SKIPPED_REJECTED_BY_DATABASE;
    }
    throw error;
  }
}

async function storeDepositAndCreditCustomer(transaction, sourceFileName) {
  const { transactionId, destinationAccount, originAccount, amountCents, currency } = transaction;

  return runInTransaction(async (connection) => {
    const isDestinationRoutingKnown = await customerAccountRepository.isKnownRoutingNumber(
      connection,
      destinationAccount.routingNumber,
    );
    if (!isDestinationRoutingKnown) {
      return DepositOutcome.SKIPPED_UNKNOWN_ROUTING_NUMBER;
    }

    // null when the destination account does not belong to a known customer.
    const customerId = await customerAccountRepository.findCustomerIdByAccount(connection, destinationAccount);

    // "Is the id already stored?" and the insert are a single atomic statement.
    // Checking first and inserting later would let two concurrent runs both
    // see "not stored" and both credit the customer.
    const wasDepositInserted = await depositRepository.insertDepositIfAbsent(connection, {
      transactionId,
      customerId,
      destinationAccount,
      originAccount,
      amountCents,
      currency,
      sourceFileName,
    });
    if (!wasDepositInserted) {
      return DepositOutcome.SKIPPED_ALREADY_PROCESSED;
    }

    if (customerId === null) {
      return DepositOutcome.RECORDED_WITHOUT_KNOWN_CUSTOMER;
    }

    await customerRepository.addDepositToCustomerTotals(connection, { customerId, amountCents });
    return DepositOutcome.CREDITED_TO_CUSTOMER;
  });
}

function isSkippedOutcome(depositOutcome) {
  return (
    depositOutcome !== DepositOutcome.CREDITED_TO_CUSTOMER &&
    depositOutcome !== DepositOutcome.RECORDED_WITHOUT_KNOWN_CUSTOMER
  );
}

module.exports = { DepositOutcome, processTransaction, isSkippedOutcome };
