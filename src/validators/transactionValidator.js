'use strict';

// Pure validation of one transaction's structure: no database access and no
// file access.

const { JsonNumberLiteral, isPlainObject } = require('../helpers/json');
const { convertDecimalTextToCents } = require('../helpers/money');

const SUPPORTED_CURRENCY = 'USD';
// 36 characters: hexadecimal digits and hyphens in the 8-4-4-4-12 layout.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROUTING_NUMBER_PATTERN = /^[0-9]{9}$/;
const ACCOUNT_NUMBER_PATTERN = /^[0-9]+$/;
// 90071992547409.91 USD. Far below what a BIGINT column stores, so a single
// deposit can never overflow the database.
const MAX_AMOUNT_CENTS = BigInt(Number.MAX_SAFE_INTEGER);

function invalid(reason) {
  return { isValid: false, reason };
}

/**
 * Validates a bank account reference ("to" or "from"): the routing number is
 * a string of exactly 9 digits and the account number is a string of digits.
 * A JSON number has already lost its leading zeros, so it is never accepted.
 * The ABA check digit of the routing number is not verified.
 */
function validateAccountReference(accountReference, fieldName) {
  if (!isPlainObject(accountReference)) {
    return invalid(`"${fieldName}" is missing or is not an object`);
  }

  const { routing_number: routingNumber, account_number: accountNumber } = accountReference;

  if (typeof routingNumber !== 'string') {
    return invalid(`"${fieldName}.routing_number" is missing or is not a string`);
  }
  if (!ROUTING_NUMBER_PATTERN.test(routingNumber)) {
    return invalid(`"${fieldName}.routing_number" is not a string of exactly 9 digits`);
  }

  if (typeof accountNumber !== 'string') {
    return invalid(`"${fieldName}.account_number" is missing or is not a string`);
  }
  if (!ACCOUNT_NUMBER_PATTERN.test(accountNumber)) {
    return invalid(`"${fieldName}.account_number" is not a string of digits`);
  }

  return {
    isValid: true,
    account: {
      routingNumber: accountReference.routing_number,
      accountNumber: accountReference.account_number,
    },
  };
}

/**
 * Validates the "amount" object: a positive JSON number with at most two
 * decimal places, in USD.
 */
function validateAmount(amount) {
  if (!isPlainObject(amount)) {
    return invalid('"amount" is missing or is not an object');
  }

  if (!(amount.amount instanceof JsonNumberLiteral)) {
    return invalid('"amount.amount" is missing or is not a number');
  }
  const amountCents = convertDecimalTextToCents(amount.amount.sourceText);
  if (amountCents === null) {
    return invalid(`"amount.amount" is not a decimal with at most two decimal places (${amount.amount.sourceText})`);
  }
  if (amountCents <= 0n) {
    return invalid(`"amount.amount" is not greater than zero (${amount.amount.sourceText})`);
  }
  if (amountCents > MAX_AMOUNT_CENTS) {
    return invalid(`"amount.amount" is above the maximum accepted amount (${amount.amount.sourceText})`);
  }

  if (typeof amount.currency !== 'string') {
    return invalid('"amount.currency" is missing or is not a string');
  }
  if (amount.currency !== SUPPORTED_CURRENCY) {
    return invalid(`"amount.currency" is not ${SUPPORTED_CURRENCY} (${amount.currency})`);
  }

  return { isValid: true, amountCents, currency: amount.currency };
}

/**
 * Validates one raw transaction from a transaction file.
 * Returns { isValid: true, transaction } with the normalized transaction, or
 * { isValid: false, reason }.
 */
function validateTransaction(rawTransaction) {
  if (!isPlainObject(rawTransaction) || rawTransaction instanceof JsonNumberLiteral) {
    return invalid('transaction is not an object');
  }

  if (typeof rawTransaction.id !== 'string') {
    return invalid('"id" is missing or is not a string');
  }
  if (!UUID_PATTERN.test(rawTransaction.id)) {
    return invalid('"id" is not in the UUID format');
  }

  const destinationValidation = validateAccountReference(rawTransaction.to, 'to');
  if (!destinationValidation.isValid) {
    return destinationValidation;
  }

  const originValidation = validateAccountReference(rawTransaction.from, 'from');
  if (!originValidation.isValid) {
    return originValidation;
  }

  const amountValidation = validateAmount(rawTransaction.amount);
  if (!amountValidation.isValid) {
    return amountValidation;
  }

  return {
    isValid: true,
    transaction: {
      // UUIDs are case-insensitive: the lower case form is the one compared
      // and stored, so the same id in another case is the same deposit.
      transactionId: rawTransaction.id.toLowerCase(),
      destinationAccount: destinationValidation.account,
      originAccount: originValidation.account,
      amountCents: amountValidation.amountCents,
      currency: amountValidation.currency,
    },
  };
}

module.exports = { validateTransaction };
