'use strict';

// Pure validation of a transaction file's content: no database access and no
// file access. The caller reads the file and passes its text.

const { parseJsonKeepingNumberText, isPlainObject } = require('../helpers/json');

/**
 * A valid file is valid JSON whose "transactions" field is an array with at
 * least one item.
 * Returns { isValid: true, transactions } or { isValid: false, reason }.
 */
function validateTransactionFileContent(fileContent) {
  let parsedContent;
  try {
    parsedContent = parseJsonKeepingNumberText(fileContent);
  } catch (error) {
    return { isValid: false, reason: `content is not valid JSON (${error.message})` };
  }

  if (!isPlainObject(parsedContent)) {
    return { isValid: false, reason: 'content is not a JSON object' };
  }

  const { transactions } = parsedContent;
  if (!Array.isArray(transactions)) {
    return { isValid: false, reason: '"transactions" is missing or is not an array' };
  }
  if (transactions.length === 0) {
    return { isValid: false, reason: '"transactions" is empty' };
  }

  return { isValid: true, transactions };
}

module.exports = { validateTransactionFileContent };
