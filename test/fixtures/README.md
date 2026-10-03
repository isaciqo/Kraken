# Test fixtures

Files to validate the processing rules and the edge cases. They live outside `data/`, so they do not change the result of the samples.

## How to run

From the project root:

    docker-compose -f docker-compose.yml -f docker-compose.test.yml up --build

`docker-compose.test.yml` mounts `test/fixtures/` in place of `data/` and uses its own project name (`kraken-payments-test`), so its containers do not mix with the ones of a normal run.

To run the samples and the fixtures and compare them automatically with the expected output (`test/expected/`):

    node test/run-tests.js

By default the application does not show why it skipped each file or transaction. To see the reasons, set `LOG_LEVEL=warn` on the `app` service.

## Conventions

- **Leonard McCoy is the canary.** Every transaction that MUST be rejected goes to McCoy's account (`011000015 / 8149516692`). If McCoy shows up with `count` greater than 0, some rule failed.
- **Line 9 also exposes failures.** The cases where the destination account was tampered with (space, letter, empty) do not land on McCoy if they are accepted by mistake: they land on line 9. It must be exactly `count=6`.
- **Ids are UUIDs that start with the file number:** `fa` + file number + `0000-0000-4000-8000-` + sequence. The id `fa050000-0000-4000-8000-000000000012` is the 12th transaction of file `05`.
- **Round amounts**, so the sums can be checked by head.
- **Default sender:** `322271627 / 5550001111`.
- **`transaction_count` is correct** in every file except `23`, which tests exactly the mismatch (it is ignored).

## Expected result

    Deposited for Jadzia Dax: count=2 sum=0.30 USD
    Deposited for James T. Kirk: count=2 sum=1500.00 USD
    Deposited for Jean-Luc Picard: count=4 sum=6.50 USD
    Deposited for Jonathan Archer: count=5000 sum=5000.00 USD
    Deposited for Leonard McCoy: count=0 sum=0.00 USD
    Deposited for Montgomery Scott: count=5 sum=1000.00 USD
    Deposited for Spock: count=3 sum=400.00 USD
    Deposited for Wesley Crusher: count=2 sum=90071992547410.00 USD
    Deposited without known user: count=6 sum=101.00 USD
    Smallest valid deposit: 0.01 USD
    Largest valid deposit: 90071992547409.91 USD

Where each line comes from:

| Line | Sum |
|---|---|
| Jadzia Dax | `01`: 0.1 + 0.2 |
| James T. Kirk | `01`: 1000.00; `02`: 500.00 |
| Jean-Luc Picard | `01`: 1.15 + 4.35 + 0.57 + 0.43 |
| Jonathan Archer | `08`: 5000 × 1.00 |
| Leonard McCoy | nothing |
| Montgomery Scott | `01`: 300 + 100.5 + 99.50; `07`: 400.00; `99`: 100.00 |
| Spock | `01`: 100.00 (account 1) + 200.00 (account 2); `23`: 100.00 |
| Wesley Crusher | `01`: 90071992547409.91 + 0.09 |
| Without known user | `01`: 10.00 + 20.00 + 30.00 + 40.00 + 0.01 + 0.99 |

## Files with transactions

### `01-valid-deposits.json` — 20 transactions, all valid

| Seq. | Case | Must happen |
|---|---|---|
| 1, 2 | Customer with 2 accounts (Spock), one at each bank | Both add up on Spock's line |
| 3 | Kirk, account `0018423486` | Goes to Kirk, not to Wesley |
| 4, 5 | Wesley, account `6018423486`. The amount 90071992547409.91 is the maximum accepted (2^53 - 1 cents), added to 0.09 | Exact sum: 90071992547410.00 |
| 6 | Kraken account with no customer (`011000015 / 0000000042`) | Line 9 |
| 7 | McCoy's account number at the OTHER bank (`021001208 / 8149516692`) | Line 9, not McCoy |
| 8 | Kirk's account without the leading zeros (`18423486`) | Line 9, not Kirk |
| 9 | Wesley's account number at Kirk's bank | Line 9, not Wesley |
| 10, 11 | 0.01 and 0.99 to the account with no customer | Line 9; 0.01 is the smallest deposit |
| 12, 13 | 0.1 + 0.2 (in floating point it gives 0.30000000000000004) | Jadzia: 0.30 |
| 14 to 17 | 1.15, 4.35, 0.57, 0.43 (multiplied by 100 in floating point they give 114.99…, 434.99…, 56.99…) | Picard: 6.50 |
| 18 to 20 | The same kind of amount written in three ways: `300`, `100.5`, `99.50` | Scott: 500.00 |

### `02-duplicates.json` — 6 transactions, 1 valid

| Seq. | Case | Must happen |
|---|---|---|
| 1 | Id of `01` #12 repeated identically in another file | Skipped; Jadzia stays with count=2 |
| 2 | Id of `01` #2 in UPPER CASE, to McCoy | Skipped as a duplicate |
| 3 | Id of `01` #3 with a different amount (999.00), to McCoy | Skipped; the first version is the one that counts |
| 4 | New id, to Kirk, 500.00 | Valid |
| 5 | The same id as #4 in the same file, to McCoy | Skipped |
| 6 | The same id as #4 for the third time, to Kirk | Skipped; Kirk ends with count=2 |

### `03-invalid-ids.json` — 16 transactions, all rejected

No id; empty id; numeric id; `null` id; text that is not a UUID; UUID without hyphens; UUID between braces; UUID with spaces around it; UUID one character short; UUID with a non-hexadecimal letter (`g`); id as an object; id as an array; boolean id; id with a null character (`\u0000`); very long id (a UUID followed by 4000 characters); two UUIDs glued together.

### `04-invalid-accounts.json` — 26 transactions, all rejected

- **`to`:** missing; `null`; text; array; no `routing_number`; no `account_number`; routing number with 8 digits; routing number with 10 digits; routing number as a number; account number as a number; account number with a letter; account number with a leading space; account number with a trailing line break; empty account number; empty routing number; account number with a hyphen.
- **`from`:** missing; `null`; no `account_number`; no `routing_number`; routing number with 8 digits; account number with a letter; account number as a number; empty account number; routing number with 10 digits; empty routing number.

### `05-invalid-amounts.json` — 24 transactions, all rejected

- **Amount:** text `"10.00"`; `null`; no `amount`; `amount` without the `amount` field; `amount` as a bare number; `null` `amount`; `1e400` (becomes Infinity); `0`; `0.00`; `-10.00`; `-0`; `10.005`; `10.000`; `1e2`; `true`; array; object.
- **Currency:** `EUR`; lower-case `usd`; `"USD "` with a space; empty; `null`; numeric (`840`); missing.

`10.000` and `1e2` are numerically valid, but the rule is strict: at most two decimal places and no scientific notation.

### `06-not-a-deposit.json` — 8 items, all rejected

| Seq. | Case |
|---|---|
| 1 | Origin equal to destination (McCoy's account on both sides) |
| 2 | McCoy's account number at a bank that is not Kraken's (`026009593`) |
| 3 | Any account at a bank that is not Kraken's |
| 4 to 7 | Transaction that is not an object: text, number, `null`, `true` |
| 8 | A valid transaction to McCoy wrapped in an array |

### `07-huge-amount-then-valid.json` — 6 transactions, 1 valid

| Seq. | Case | Must happen |
|---|---|---|
| 1 | Huge amount `100000000000000000` to McCoy | Rejected: above the maximum amount |
| 2 | `92233720368547758.08`, one cent above the `BIGINT` maximum | Rejected |
| 3, 4 | Two huge amounts of `50000000000000000.00` to the same customer (McCoy) | Rejected during validation; the sum never reaches the database |
| 5 | `90071992547409.92`, one cent above the maximum accepted amount | Rejected |
| 6 | 400.00 to Scott | Valid: the previous rejections do not bring down the file |

### `08-volume.json` — 5000 valid transactions

5000 deposits of 1.00 to Jonathan Archer. It checks that the count and the sum hold with volume and gives an idea of the processing time.

### `23-transaction-count-mismatch.json` — 1 valid transaction

`transaction_count` says 3 and the array has 1. The counter is ignored: the file is processed and the 100.00 goes to Spock.

## Files that must be rejected or ignored as a whole

Each one carries a well-formed transaction to McCoy, when the format allows it. None of them may be credited.

| File | Case | Must happen |
|---|---|---|
| `20-broken-json.json` | JSON cut in the middle, after a complete transaction | File rejected; nothing that came before the cut is used |
| `21-no-transactions-field.json` | The transactions are in the `data` field | File rejected |
| `22-transactions-not-array.json` | `transactions` is an object | File rejected |
| `24-empty-transactions.json` | `transactions` is an empty array | File rejected |
| `25-empty-file.json` | 0-byte file | File rejected |
| `26-top-level-array.json` | The root of the JSON is an array | File rejected |
| `27-valid-json-wrong-extension.txt` | Valid JSON with a `.txt` extension | Ignored |
| `28-uppercase-extension.JSON` | Valid JSON with an upper-case extension | Ignored |
| `29-directory.json/` | A directory whose name ends in `.json`, with a valid file inside | Ignored; subdirectories are not read |
| `30-utf8-bom.json` | Valid JSON preceded by a BOM | File rejected |
| `99-valid-after-bad-files.json` | A valid file, read after all the bad ones | Processed: 100.00 to Scott. It proves that a bad file does not bring down the processing |

## When McCoy shows up with count > 0

The id prefix and the `source_file` column tell where each wrong deposit came from:

    docker-compose -f docker-compose.yml -f docker-compose.test.yml exec database \
      psql -U kraken -d kraken_payments \
      -c "SELECT transaction_id, amount_cents, source_file FROM deposits WHERE customer_id = 5 ORDER BY source_file, transaction_id"
