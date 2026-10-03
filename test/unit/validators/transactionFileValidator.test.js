'use strict';

const { validateTransactionFileContent } = require('../../../src/validators/transactionFileValidator');

const ONE_TRANSACTION = '{"id": "any"}';

describe('validateTransactionFileContent', () => {
  describe('valid files', () => {
    test('accepts valid JSON whose "transactions" is an array with one item', () => {
      const result = validateTransactionFileContent(`{"transactions": [${ONE_TRANSACTION}]}`);

      expect(result.isValid).toBe(true);
      expect(result.transactions).toEqual([{ id: 'any' }]);
    });

    test('returns the transactions in the order of the array', () => {
      const result = validateTransactionFileContent('{"transactions": [{"id": "first"}, {"id": "second"}]}');

      expect(result.transactions.map((transaction) => transaction.id)).toEqual(['first', 'second']);
    });

    test('ignores "transaction_count" when it differs from the array size', () => {
      const result = validateTransactionFileContent(`{"transaction_count": 3, "transactions": [${ONE_TRANSACTION}]}`);

      expect(result.isValid).toBe(true);
      expect(result.transactions).toHaveLength(1);
    });

    test('ignores a missing "transaction_count"', () => {
      expect(validateTransactionFileContent(`{"transactions": [${ONE_TRANSACTION}]}`).isValid).toBe(true);
    });

    test('does not validate the items of the array', () => {
      const result = validateTransactionFileContent('{"transactions": [null, "text"]}');

      expect(result.isValid).toBe(true);
      expect(result.transactions).toEqual([null, 'text']);
    });
  });

  describe('refused files', () => {
    test.each([
      ['truncated JSON', `{"transactions": [${ONE_TRANSACTION}`],
      ['empty content', ''],
      ['plain text', 'not json at all'],
      ['JSON preceded by a BOM', `﻿{"transactions": [${ONE_TRANSACTION}]}`],
    ])('refuses content that is not valid JSON: %s', (caseName, fileContent) => {
      const result = validateTransactionFileContent(fileContent);

      expect(result.isValid).toBe(false);
      expect(result.reason).toMatch(/^content is not valid JSON/);
      expect(result.transactions).toBeUndefined();
    });

    test.each([
      ['an array', `[${ONE_TRANSACTION}]`],
      ['null', 'null'],
      ['a string', '"transactions"'],
      ['a boolean', 'true'],
    ])('refuses content whose root is %s', (caseName, fileContent) => {
      const result = validateTransactionFileContent(fileContent);

      expect(result).toEqual({ isValid: false, reason: 'content is not a JSON object' });
    });

    test('refuses content whose root is a number', () => {
      expect(validateTransactionFileContent('42').isValid).toBe(false);
    });

    test.each([
      ['the field is missing', '{"transaction_count": 1}'],
      ['the transactions are under another field', `{"data": [${ONE_TRANSACTION}]}`],
      ['it is an object', `{"transactions": {"first": ${ONE_TRANSACTION}}}`],
      ['it is a string', '{"transactions": "none"}'],
      ['it is a number', '{"transactions": 1}'],
      ['it is null', '{"transactions": null}'],
    ])('refuses when "transactions" is not an array: %s', (caseName, fileContent) => {
      const result = validateTransactionFileContent(fileContent);

      expect(result).toEqual({ isValid: false, reason: '"transactions" is missing or is not an array' });
    });

    test('refuses when "transactions" is an empty array', () => {
      const result = validateTransactionFileContent('{"transaction_count": 0, "transactions": []}');

      expect(result).toEqual({ isValid: false, reason: '"transactions" is empty' });
    });
  });
});
