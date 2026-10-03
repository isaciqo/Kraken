'use strict';

/**
 * A number exactly as it was written in the JSON text ("724.6").
 * JSON.parse never creates class instances by itself, so an instance of this
 * class can only come from a real JSON number, never from a string or object
 * sent in the file.
 */
class JsonNumberLiteral {
  constructor(sourceText) {
    this.sourceText = sourceText;
  }
}

/**
 * Parses JSON keeping every number as the text written in the file instead of
 * a floating point value, so money amounts can be converted to cents exactly.
 * Throws SyntaxError when the text is not valid JSON.
 */
function parseJsonKeepingNumberText(jsonText) {
  return JSON.parse(jsonText, (key, value, context) =>
    typeof value === 'number' ? new JsonNumberLiteral(context.source) : value,
  );
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

module.exports = { JsonNumberLiteral, parseJsonKeepingNumberText, isPlainObject };
