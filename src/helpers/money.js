'use strict';

const CENTS_PER_DOLLAR = 100n;

// Digits, optionally followed by a dot and one or two decimal digits. No sign,
// no exponent, no thousands separator.
const DECIMAL_AMOUNT_PATTERN = /^(\d+)(?:\.(\d{1,2}))?$/;

/**
 * Converts a decimal amount written as text ("724.6") into integer cents (72460n).
 * Works on the text so the value never passes through a floating point number.
 * Returns null when the text is not an amount with at most two decimal places.
 */
function convertDecimalTextToCents(decimalText) {
  if (typeof decimalText !== 'string') {
    return null;
  }
  const match = DECIMAL_AMOUNT_PATTERN.exec(decimalText);
  if (match === null) {
    return null;
  }
  const [, dollarsText, centsText = ''] = match;
  return BigInt(dollarsText) * CENTS_PER_DOLLAR + BigInt(centsText.padEnd(2, '0'));
}

/**
 * Formats integer cents as "x.xx". Accepts a BigInt or the string that
 * PostgreSQL returns for BIGINT columns. Only non-negative amounts exist here.
 */
function formatCentsAsDecimalText(cents) {
  const centsAsBigInt = BigInt(cents);
  if (centsAsBigInt < 0n) {
    throw new RangeError(`Cannot format a negative amount: ${cents}`);
  }
  const dollars = centsAsBigInt / CENTS_PER_DOLLAR;
  const remainingCents = centsAsBigInt % CENTS_PER_DOLLAR;
  return `${dollars}.${String(remainingCents).padStart(2, '0')}`;
}

module.exports = { convertDecimalTextToCents, formatCentsAsDecimalText };
