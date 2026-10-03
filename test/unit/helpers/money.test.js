'use strict';

const { convertDecimalTextToCents, formatCentsAsDecimalText } = require('../../../src/helpers/money');

describe('convertDecimalTextToCents', () => {
  test.each([
    ['0.29', 29n],
    ['0.1', 10n],
    ['1000.1', 100010n],
    ['0.01', 1n],
    ['0.57', 57n],
    ['1.15', 115n],
    ['4.35', 435n],
    ['724.6', 72460n],
    ['99.50', 9950n],
    ['300', 30000n],
    ['0', 0n],
    ['0.00', 0n],
    ['007.50', 750n],
  ])('converts "%s" into %p cents', (decimalText, expectedCents) => {
    expect(convertDecimalTextToCents(decimalText)).toBe(expectedCents);
  });

  test('converts amounts that a floating point number cannot represent', () => {
    expect(convertDecimalTextToCents('90071992547409.93')).toBe(9007199254740993n);
    expect(convertDecimalTextToCents('92233720368547758.07')).toBe(9223372036854775807n);
  });

  test.each([
    ['three decimal places', '10.005'],
    ['three decimal places that are zeros', '10.000'],
    ['a negative sign', '-1'],
    ['a positive sign', '+1'],
    ['scientific notation', '1e3'],
    ['no digit before the dot', '.5'],
    ['no digit after the dot', '5.'],
    ['a leading space', ' 1'],
    ['a trailing space', '1 '],
    ['a thousands separator', '1,000.00'],
    ['a comma as decimal separator', '10,50'],
    ['a currency symbol', '$10.00'],
    ['an empty text', ''],
    ['letters', 'ten'],
    ['a trailing line break', '10.00\n'],
  ])('returns null for a text with %s', (caseName, decimalText) => {
    expect(convertDecimalTextToCents(decimalText)).toBeNull();
  });

  test.each([
    ['a number', 10.5],
    ['a BigInt', 10n],
    ['null', null],
    ['undefined', undefined],
    ['an object', { amount: '10.00' }],
  ])('returns null when the value is %s instead of text', (caseName, value) => {
    expect(convertDecimalTextToCents(value)).toBeNull();
  });
});

describe('formatCentsAsDecimalText', () => {
  test.each([
    [29n, '0.29'],
    [10n, '0.10'],
    [100010n, '1000.10'],
    [0n, '0.00'],
    [1n, '0.01'],
    [5n, '0.05'],
    [100n, '1.00'],
    [316073n, '3160.73'],
    [100000000n, '1000000.00'],
  ])('formats %p cents as "%s"', (cents, expectedText) => {
    expect(formatCentsAsDecimalText(cents)).toBe(expectedText);
  });

  test('accepts the text that PostgreSQL returns for BIGINT columns', () => {
    expect(formatCentsAsDecimalText('316073')).toBe('3160.73');
    expect(formatCentsAsDecimalText('0')).toBe('0.00');
  });

  test('formats amounts beyond the precision of a floating point number', () => {
    expect(formatCentsAsDecimalText(9007199254740993n)).toBe('90071992547409.93');
    expect(formatCentsAsDecimalText('10000000000000000000')).toBe('100000000000000000.00');
  });

  test('never adds a thousands separator', () => {
    expect(formatCentsAsDecimalText(123456789012n)).toBe('1234567890.12');
  });

  test('throws for a negative amount', () => {
    expect(() => formatCentsAsDecimalText(-1n)).toThrow(RangeError);
  });
});

describe('conversion followed by formatting', () => {
  test.each([
    ['0.29', '0.29'],
    ['0.1', '0.10'],
    ['1000.1', '1000.10'],
    ['300', '300.00'],
  ])('"%s" comes back as "%s"', (decimalText, expectedText) => {
    expect(formatCentsAsDecimalText(convertDecimalTextToCents(decimalText))).toBe(expectedText);
  });

  test('summing cents has no floating point error', () => {
    const totalCents = convertDecimalTextToCents('0.1') + convertDecimalTextToCents('0.2');

    expect(formatCentsAsDecimalText(totalCents)).toBe('0.30');
  });
});
