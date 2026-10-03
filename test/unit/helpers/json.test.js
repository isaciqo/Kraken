'use strict';

const { JsonNumberLiteral, parseJsonKeepingNumberText, isPlainObject } = require('../../../src/helpers/json');

describe('parseJsonKeepingNumberText', () => {
  test.each(['724.6', '99.50', '10.000', '1e2', '1e400', '-0', '90071992547409.93'])(
    'keeps the number %s exactly as written',
    (numberText) => {
      const parsed = parseJsonKeepingNumberText(`{"amount": ${numberText}}`);

      expect(parsed.amount).toBeInstanceOf(JsonNumberLiteral);
      expect(parsed.amount.sourceText).toBe(numberText);
    },
  );

  test('leaves strings, booleans, null, arrays and objects as they are', () => {
    const parsed = parseJsonKeepingNumberText('{"text": "10.00", "flag": true, "nothing": null, "list": ["a"], "inner": {"key": "value"}}');

    expect(parsed).toEqual({ text: '10.00', flag: true, nothing: null, list: ['a'], inner: { key: 'value' } });
  });

  test('a number sent as a string is not a JsonNumberLiteral', () => {
    expect(parseJsonKeepingNumberText('{"amount": "10.00"}').amount).not.toBeInstanceOf(JsonNumberLiteral);
  });

  test('an object shaped like a JsonNumberLiteral is not a JsonNumberLiteral', () => {
    const parsed = parseJsonKeepingNumberText('{"amount": {"sourceText": "10.00"}}');

    expect(parsed.amount).not.toBeInstanceOf(JsonNumberLiteral);
  });

  test('throws SyntaxError for invalid JSON', () => {
    expect(() => parseJsonKeepingNumberText('{"amount": ')).toThrow(SyntaxError);
  });
});

describe('isPlainObject', () => {
  test('is true for an object', () => {
    expect(isPlainObject({})).toBe(true);
  });

  test.each([
    ['null', null],
    ['an array', []],
    ['a string', 'text'],
    ['a number', 1],
    ['undefined', undefined],
  ])('is false for %s', (caseName, value) => {
    expect(isPlainObject(value)).toBe(false);
  });
});
