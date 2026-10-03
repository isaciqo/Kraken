'use strict';

const { validateTransaction } = require('../../../src/validators/transactionValidator');
const { parseJsonKeepingNumberText } = require('../../../src/helpers/json');

const VALID_ID = '1e471dca-dcb2-47f8-8077-63659f2274ee';
const VALID_DESTINATION = { routing_number: '011000015', account_number: '0018423486' };
const VALID_ORIGIN = { routing_number: '130495809', account_number: '9834891235' };

// Marks a field that must be left out of the transaction.
const OMITTED = Symbol('omitted');

/**
 * Builds a raw transaction the same way the application receives it: as JSON
 * text parsed by parseJsonKeepingNumberText. Every argument defaults to a
 * valid value, so each test changes only the field it is about.
 * `amountLiteral` is the number exactly as written in the file; `amountJson`
 * replaces the whole "amount" field with raw JSON text.
 */
function buildRawTransaction({
  id = VALID_ID,
  to = VALID_DESTINATION,
  from = VALID_ORIGIN,
  amountLiteral = '10.00',
  currency = 'USD',
  amountJson,
  extraFieldsJson = '',
} = {}) {
  const fields = [];
  if (id !== OMITTED) fields.push(`"id": ${JSON.stringify(id)}`);
  if (to !== OMITTED) fields.push(`"to": ${JSON.stringify(to)}`);
  if (from !== OMITTED) fields.push(`"from": ${JSON.stringify(from)}`);
  if (amountJson !== OMITTED) {
    const currencyJson = currency === OMITTED ? '' : `, "currency": ${JSON.stringify(currency)}`;
    fields.push(`"amount": ${amountJson ?? `{"amount": ${amountLiteral}${currencyJson}}`}`);
  }
  return parseJsonKeepingNumberText(`{${fields.join(', ')}${extraFieldsJson}}`);
}

function expectRefused(rawTransaction, reasonPattern) {
  const result = validateTransaction(rawTransaction);

  expect(result.isValid).toBe(false);
  expect(result.reason).toMatch(reasonPattern);
  expect(result.transaction).toBeUndefined();
}

describe('validateTransaction', () => {
  describe('valid transaction', () => {
    test('returns the normalized transaction', () => {
      const result = validateTransaction(buildRawTransaction({ amountLiteral: '724.6' }));

      expect(result).toEqual({
        isValid: true,
        transaction: {
          transactionId: VALID_ID,
          destinationAccount: { routingNumber: '011000015', accountNumber: '0018423486' },
          originAccount: { routingNumber: '130495809', accountNumber: '9834891235' },
          amountCents: 72460n,
          currency: 'USD',
        },
      });
    });

    test('ignores fields that are not part of the known structure', () => {
      const rawTransaction = buildRawTransaction({ extraFieldsJson: ', "status": "failed", "type": "reversal"' });

      expect(validateTransaction(rawTransaction).isValid).toBe(true);
    });
  });

  describe('transaction shape', () => {
    test.each([
      ['null', 'null'],
      ['a string', '"a transaction"'],
      ['a number', '42'],
      ['a boolean', 'true'],
      ['an array', '[]'],
    ])('refuses a transaction that is %s', (caseName, transactionJson) => {
      expectRefused(parseJsonKeepingNumberText(transactionJson), /^transaction is not an object$/);
    });
  });

  describe('id', () => {
    test.each([
      ['missing', OMITTED],
      ['a number', 12345],
      ['null', null],
      ['a boolean', true],
      ['an object', { value: VALID_ID }],
      ['an array', [VALID_ID]],
    ])('refuses an id that is %s', (caseName, id) => {
      expectRefused(buildRawTransaction({ id }), /"id" is missing or is not a string/);
    });

    test.each([
      ['empty', ''],
      ['free text', 'not-a-uuid'],
      ['a UUID without hyphens', VALID_ID.replaceAll('-', '')],
      ['a UUID between braces', `{${VALID_ID}}`],
      ['a UUID with a leading space', ` ${VALID_ID}`],
      ['a UUID with a trailing space', `${VALID_ID} `],
      ['a UUID one character short', VALID_ID.slice(0, -1)],
      ['a UUID one character long', `${VALID_ID}0`],
      ['a UUID with a non-hexadecimal letter', VALID_ID.replace('1e47', 'ge47')],
      ['a UUID containing the NUL character', `${VALID_ID.slice(0, -3)}\u0000ee`],
      ['a UUID followed by a line break', `${VALID_ID}\n`],
      ['thousands of characters long', `${VALID_ID}-${'0123456789abcdef'.repeat(250)}`],
      ['two UUIDs glued together', `${VALID_ID}${VALID_ID}`],
    ])('refuses an id that is %s', (caseName, id) => {
      expectRefused(buildRawTransaction({ id }), /"id" is not in the UUID format/);
    });

    test('accepts a UUID in upper case and normalizes it to lower case', () => {
      const result = validateTransaction(buildRawTransaction({ id: VALID_ID.toUpperCase() }));

      expect(result.isValid).toBe(true);
      expect(result.transaction.transactionId).toBe(VALID_ID);
    });

    test('normalizes a mixed case UUID to the same id as its lower case form', () => {
      const mixedCaseId = '1E471dca-DCB2-47f8-8077-63659F2274EE';

      expect(validateTransaction(buildRawTransaction({ id: mixedCaseId })).transaction.transactionId).toBe(VALID_ID);
    });
  });

  describe.each([
    ['to', 'destinationAccount'],
    ['from', 'originAccount'],
  ])('account reference "%s"', (fieldName, normalizedFieldName) => {
    const VALID_ACCOUNT = { routing_number: '021001208', account_number: '0018423486' };
    const withAccount = (account) => buildRawTransaction({ [fieldName]: account });

    test.each([
      ['missing', OMITTED],
      ['null', null],
      ['a string', '021001208/0018423486'],
      ['an array', [VALID_ACCOUNT]],
    ])('refuses when the field is %s', (caseName, account) => {
      expectRefused(withAccount(account), new RegExp(`^"${fieldName}" is missing or is not an object$`));
    });

    test.each([
      ['missing', { account_number: '0018423486' }],
      ['a number', { ...VALID_ACCOUNT, routing_number: 21001208 }],
      ['null', { ...VALID_ACCOUNT, routing_number: null }],
    ])('refuses a routing number that is %s', (caseName, account) => {
      expectRefused(withAccount(account), new RegExp(`"${fieldName}.routing_number" is missing or is not a string`));
    });

    test.each([
      ['8 digits', '02100120'],
      ['10 digits', '0210012080'],
      ['empty', ''],
      ['9 characters with a letter', '02100120A'],
      ['9 digits and a leading space', ' 021001208'],
      ['9 digits and a trailing line break', '021001208\n'],
      ['9 digits with a hyphen', '0210-01208'],
    ])('refuses a routing number with %s', (caseName, routingNumber) => {
      expectRefused(
        withAccount({ ...VALID_ACCOUNT, routing_number: routingNumber }),
        new RegExp(`"${fieldName}.routing_number" is not a string of exactly 9 digits`),
      );
    });

    test('accepts a routing number with exactly 9 digits', () => {
      const result = validateTransaction(withAccount(VALID_ACCOUNT));

      expect(result.isValid).toBe(true);
      expect(result.transaction[normalizedFieldName].routingNumber).toBe('021001208');
    });

    test('does not verify the ABA check digit of the routing number', () => {
      expect(validateTransaction(withAccount({ ...VALID_ACCOUNT, routing_number: '000000001' })).isValid).toBe(true);
    });

    test.each([
      ['missing', { routing_number: '021001208' }],
      ['a number', { ...VALID_ACCOUNT, account_number: 18423486 }],
      ['null', { ...VALID_ACCOUNT, account_number: null }],
    ])('refuses an account number that is %s', (caseName, account) => {
      expectRefused(withAccount(account), new RegExp(`"${fieldName}.account_number" is missing or is not a string`));
    });

    test.each([
      ['empty', ''],
      ['with a letter', '00184I3486'],
      ['with a leading space', ' 0018423486'],
      ['with a trailing line break', '0018423486\n'],
      ['with a hyphen', '0018-423486'],
    ])('refuses an account number %s', (caseName, accountNumber) => {
      expectRefused(
        withAccount({ ...VALID_ACCOUNT, account_number: accountNumber }),
        new RegExp(`"${fieldName}.account_number" is not a string of digits`),
      );
    });

    test('keeps the leading zeros of the account number', () => {
      const result = validateTransaction(withAccount(VALID_ACCOUNT));

      expect(result.transaction[normalizedFieldName].accountNumber).toBe('0018423486');
    });

    test('accepts account numbers of any length', () => {
      expect(validateTransaction(withAccount({ ...VALID_ACCOUNT, account_number: '1' })).isValid).toBe(true);
      expect(validateTransaction(withAccount({ ...VALID_ACCOUNT, account_number: '1'.repeat(30) })).isValid).toBe(true);
    });
  });

  describe('amount', () => {
    test.each([
      ['missing', OMITTED],
      ['null', 'null'],
      ['a string', '"10.00 USD"'],
      ['an array', '[10.00, "USD"]'],
    ])('refuses when the "amount" field is %s', (caseName, amountJson) => {
      expectRefused(buildRawTransaction({ amountJson }), /^"amount" is missing or is not an object$/);
    });

    test('refuses when the "amount" field is a bare number instead of an object', () => {
      // The reason names the inner field because a parsed JSON number is itself an object.
      expectRefused(buildRawTransaction({ amountJson: '10.00' }), /"amount.amount" is missing or is not a number/);
    });

    test.each([
      ['missing', '{"currency": "USD"}'],
      ['a string', '{"amount": "10.00", "currency": "USD"}'],
      ['null', '{"amount": null, "currency": "USD"}'],
      ['a boolean', '{"amount": true, "currency": "USD"}'],
      ['an array', '{"amount": [10.00], "currency": "USD"}'],
      ['an object', '{"amount": {"value": 10.00}, "currency": "USD"}'],
    ])('refuses when "amount.amount" is %s', (caseName, amountJson) => {
      expectRefused(buildRawTransaction({ amountJson }), /"amount.amount" is missing or is not a number/);
    });

    describe('lower edge', () => {
      test('accepts 0.01, the smallest valid amount', () => {
        const result = validateTransaction(buildRawTransaction({ amountLiteral: '0.01' }));

        expect(result.isValid).toBe(true);
        expect(result.transaction.amountCents).toBe(1n);
      });

      test.each(['0', '0.0', '0.00'])('refuses zero written as %s', (amountLiteral) => {
        expectRefused(buildRawTransaction({ amountLiteral }), /"amount.amount" is not greater than zero/);
      });

      test.each(['-0.01', '-10.00', '-0'])('refuses the negative amount %s', (amountLiteral) => {
        expectRefused(buildRawTransaction({ amountLiteral }), /"amount.amount" is not a decimal with at most two decimal places/);
      });
    });

    describe('decimal places', () => {
      test.each([
        ['no decimal places', '10', 1000n],
        ['one decimal place', '10.5', 1050n],
        ['two decimal places', '10.25', 1025n],
      ])('accepts an amount with %s', (caseName, amountLiteral, expectedCents) => {
        const result = validateTransaction(buildRawTransaction({ amountLiteral }));

        expect(result.isValid).toBe(true);
        expect(result.transaction.amountCents).toBe(expectedCents);
      });

      test.each([
        ['three decimal places', '10.005'],
        ['three decimal places that are zeros', '10.000'],
        ['many decimal places', '0.10000000000000001'],
        ['scientific notation', '1e2'],
        ['scientific notation that becomes Infinity', '1e400'],
      ])('refuses an amount with %s', (caseName, amountLiteral) => {
        expectRefused(buildRawTransaction({ amountLiteral }), /"amount.amount" is not a decimal with at most two decimal places/);
      });
    });

    describe('upper edge', () => {
      test('accepts 90071992547409.91, the maximum amount', () => {
        const result = validateTransaction(buildRawTransaction({ amountLiteral: '90071992547409.91' }));

        expect(result.isValid).toBe(true);
        expect(result.transaction.amountCents).toBe(9007199254740991n);
      });

      test.each(['90071992547409.92', '50000000000000000.00', '92233720368547758.08', '100000000000000000'])(
        'refuses %s, above the maximum amount',
        (amountLiteral) => {
          expectRefused(buildRawTransaction({ amountLiteral }), /"amount.amount" is above the maximum accepted amount/);
        },
      );
    });

    describe('currency', () => {
      test.each([
        ['missing', OMITTED],
        ['null', null],
        ['a number', 840],
      ])('refuses a currency that is %s', (caseName, currency) => {
        expectRefused(buildRawTransaction({ currency }), /"amount.currency" is missing or is not a string/);
      });

      test.each(['EUR', 'usd', 'Usd', 'USD ', ' USD', ''])('refuses the currency "%s"', (currency) => {
        expectRefused(buildRawTransaction({ currency }), /"amount.currency" is not USD/);
      });

      test('accepts USD', () => {
        expect(validateTransaction(buildRawTransaction({ currency: 'USD' })).transaction.currency).toBe('USD');
      });
    });
  });

  describe('order of the checks', () => {
    test('reports the id before the accounts and the amount', () => {
      const rawTransaction = buildRawTransaction({ id: 'bad', to: OMITTED, amountLiteral: '0' });

      expectRefused(rawTransaction, /"id" is not in the UUID format/);
    });
  });
});
