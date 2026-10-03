# RULES — Kraken challenge (Fiat Payments)

Assumptions and rules of the solution, each one with the reason behind it. This file describes what the code does today. It was written in Portuguese during the build session and translated into English. The consolidated description of the solution is in [SOLUTION.md](../SOLUTION.md).

- **[P]** = assumption or decision defined by me (Isaci). The decisions taken after the QA review are detailed in [DECISOES.md](DECISOES.md); the "Ref." column points to the number there (D1, D2…).
- **[R]** = rule derived from the README, from the data or from the general principle.

## 0. General principle

**When in doubt, do not credit.** Crediting too much is a real loss of money; not crediting can be fixed later.

The solution is designed as if it were going to run in production, with real data and a deploy process:

- State lives in PostgreSQL, not in the process memory. Deduplication, classification and totals are done by the database.
- The critical rules are protected by database constraints, not only by code.
- Every decision is deterministic: same files, same result.

## 1. Stack

| # | Rule | Why | Ref. |
|---|---|---|---|
| P1 | Node.js 22 (JavaScript) and PostgreSQL 16. | It is what the README asks for; PostgreSQL provides transactions and constraints, which are the base of the concurrency rules. | |
| R1 | It starts with `docker-compose up` alone, in a clean environment, with no manual step. | The README disqualifies any submission that needs an extra command. | |
| R2 | The application only starts after the database healthcheck, done with `pg_isready -h 127.0.0.1`. | During initialisation Postgres runs a temporary server that only accepts local connections; checking over the network avoids connecting too early. | |

## 2. Account identity

| # | Rule | Why | Ref. |
|---|---|---|---|
| P2 | An account is the PAIR `routing_number` + `account_number`, never the `account_number` alone. | The same account number can exist at different banks. sample2 has the case: `021001208 / 8149516692` uses McCoy's account number with another routing number, and it is not his. | |
| P3 | Routing and account numbers are text. Exact comparison, character by character, with no normalisation. | Leading zeros matter: `0018423486` (Kirk) and `6018423486` (Crusher) differ only at the start. | |
| P4 | `routing_number` has exactly 9 digits and `account_number` has digits only, in both `to` and `from`. A JSON number, a space, a letter or an empty value makes the transaction invalid. The ABA check digit is not verified. | A corrupted field makes the whole record unreliable. Verifying the check digit of the origin routing number would reject legitimate money. | D2 |
| R3 | Customers and accounts are kept in database tables (seeded at start-up), and the link deposit → customer is made by a database query. | The list of accounts is data, not code. | |
| R4 | A customer can have several accounts (Spock has two); the deposits of all of them add up on the same line. | The README lists both accounts under the same customer. | |

## 3. Money

| # | Rule | Why | Ref. |
|---|---|---|---|
| P5 | Amounts in integer cents in the code (`BigInt`) and `BIGINT` in the database. USD only. | Floating point gets money sums wrong (`0.1 + 0.2`). | |
| R5 | The amount is converted from the original text of the number in the JSON, not from the already parsed `double`. | `724.6` becomes a double before it reaches the code; multiplying by 100 and rounding can be off by one cent. | |
| R6 | Valid amount: a decimal JSON number, greater than zero, with at most 2 decimal places. Zero, negative, 3 or more decimal places (including `10.000`), scientific notation, text and null are invalid. | There is no deposit of zero or of a negative amount. Rounding the third decimal place would be inventing a value. | |
| P6 | Maximum amount of one deposit: 90071992547409.91 (`Number.MAX_SAFE_INTEGER` in cents). If a customer's sum still overflows the database column, only that transaction is skipped and the job goes on. | A huge value used to bring down the whole job, and nobody received the report. | D4 |
| R7 | Valid currency: exactly `"USD"`. `"usd"`, `"EUR"`, `"USD "` or a missing currency are invalid. | The report is in USD only; converting or assuming a currency is crediting in the dark. | |
| R8 | Sums and the `x.xx` formatting are done with integers, with no thousands separator, always with 2 decimal places. | `pg` returns `BIGINT` as text; converting it to `Number` brings the precision problem back. | |

## 4. What a valid deposit is

| # | Rule | Why | Ref. |
|---|---|---|---|
| R9 | The transaction must have the expected structure: `id`, `to`, `from`, `amount.amount` and `amount.currency`, with the correct types. Otherwise it is invalid. | Without the complete structure it is not possible to say what the transaction is. | |
| P7 | The `id` must be in the UUID format (36 characters, hexadecimal digits and hyphens). | It blocks ids with a null character or with thousands of characters before they reach the database, where they used to bring down the job. | D5 |
| P8 | Unknown fields (for example `status`) are ignored. | We do not validate a field when we do not know whether it will be sent. | D9 |
| P9 | Origin equal to destination (same routing number and same account) is not a deposit. | It is not money coming in. | |
| P10 | A transaction is only a deposit when its `to.routing_number` is a known routing number (the ones of the customers' accounts: `011000015` and `021001208`). An unknown routing number is skipped and enters no line of the report. | A transaction to another bank is not money entering our accounts. | |
| P11 | Known routing number + a customer's account → deposit of that customer (lines 1 to 8). Known routing number + unknown account → deposit "without known user" (line 9). | The money reached the partner bank, but we do not know whose it is: it is counted, and credited to nobody. | |
| R10 | The credited customer is stored together with the deposit, at processing time. | A deposit that was already credited cannot silently change owner if the accounts table changes. | |

The checks run in this order: structure (R9, P7, P4, R6, P6, R7), origin equal to destination (P9), known routing number (P10), duplicate id (P12), customer lookup (P11).

## 5. Duplicates and order

| # | Rule | Why | Ref. |
|---|---|---|---|
| P12 | An `id` that is already in the deposits table is not processed again: the first stored version is the one that counts. | The endpoint is polled, so the same transaction comes back in different calls. | |
| P13 | The `id` is compared and stored in lower case: the same id in upper case is the same deposit. | UUIDs are case-insensitive; without this, the same deposit would be credited twice. | D1 |
| P14 | Files are read in alphabetical order; inside a file, in the order of the array. | "First version" is only deterministic if the order is fixed. | |
| R11 | "Alphabetical" = comparison of the file names by character code, with no locale. `sample10.json` comes before `sample2.json`. | Locale-based ordering changes between machines and Docker images. | |
| R12 | Deduplication is done by the primary key of the database (`INSERT ... ON CONFLICT DO NOTHING`), never by "query first, insert later". | Querying before inserting has a race condition. | |

## 6. Files

| # | Rule | Why | Ref. |
|---|---|---|---|
| P15 | The `.json` files (lower-case extension) of the `data/` directory are read, without entering subdirectories. Everything else is ignored. | My decision. The README says "all files in the mounted data directory"; see section 9. | |
| P16 | Valid file: valid JSON, with `transactions` being an array with at least 1 item. If it fails, the file is skipped and the job goes on. | A bad file never brings down the processing. | |
| P17 | `transaction_count` is ignored; the array is what counts. | The missing transactions are not in the file anyway; rejecting the file would only throw away the valid ones. | D3 |
| P18 | Each file is loaded entirely into memory. Known limitation. | Each file is the response of one call to the endpoint; if memory runs out, the job stops without crediting anything wrong. | D7 |
| P19 | Only the valid deposits are stored (`deposits` table). Rejected transactions are not stored. | The README asks to "store all deposits". | |

## 7. Database, concurrency and failures

| # | Rule | Why | Ref. |
|---|---|---|---|
| P20 | The deposit and the customer's total (`deposit_count`, `total_deposited_cents`) are written in the SAME database transaction, one per transaction of the file. | Either both are stored, or neither. | |
| R13 | The customer's total is incremented inside the `UPDATE` itself. | Two simultaneous deposits cannot overwrite each other. | |
| R14 | The report is read from the database in a single snapshot (`REPEATABLE READ`), after all the processing. | The README requires the numbers to come from the database; a single snapshot prevents lines computed at different moments. | |
| R15 | Database constraints: unique `id`, amount `> 0`, currency `= 'USD'`, foreign key to the customer, non-negative customer totals, digits-only routing and account numbers of the customers. | A bug in the code cannot store an impossible deposit. | |
| P21 | The database is emptied at the start of every run, and the Postgres data lives in tmpfs, with no volume. Two simultaneous instances against the same database are not supported. | Every `docker-compose up` must start from scratch, even with the database still running. | D10 |
| P22 | An infrastructure failure (database down, connection lost, `data/` missing) stops the job in a controlled way: a message on stderr saying where it stopped, exit code 1 and no report. | A partial report is worse than none; the stop must be predictable. | D6 |

## 8. Output

| # | Rule | Why | Ref. |
|---|---|---|---|
| P23 | stdout has ONLY the 11 lines of the report, in the exact format of the README. | The check is probably automatic and compares the text. | |
| P24 | No log other than the report: the rejection reasons are not shown (only with `LOG_LEVEL=warn`) and the Postgres output is discarded. The only exception is the failure message of P22, on stderr. | The README defines exactly what must be printed. | D8 |
| P25 | Line 9 = valid deposits to accounts without a known customer. Lines 10 and 11 consider all the valid deposits, including the ones of line 9. | The README says "valid deposit" without restricting it to customers. | |
| R16 | Order and names of the customers exactly as in the README; a customer without deposits is printed with `count=0 sum=0.00 USD`. | The 11 lines are mandatory, with or without activity. | |
| R17 | With no valid deposit at all, lines 10 and 11 print `0.00 USD`. | It keeps the 11 lines in the format. | |

### Expected result with the two samples

The 45 transactions of the samples are valid deposits.

    Deposited for Jadzia Dax: count=6 sum=3160.73 USD
    Deposited for James T. Kirk: count=5 sum=2087.89 USD
    Deposited for Jean-Luc Picard: count=3 sum=1573.55 USD
    Deposited for Jonathan Archer: count=7 sum=3763.39 USD
    Deposited for Leonard McCoy: count=3 sum=839.65 USD
    Deposited for Montgomery Scott: count=4 sum=2360.65 USD
    Deposited for Spock: count=10 sum=5312.81 USD
    Deposited for Wesley Crusher: count=3 sum=1694.19 USD
    Deposited without known user: count=4 sum=1786.67 USD
    Smallest valid deposit: 140.67 USD
    Largest valid deposit: 988.53 USD

The 4 of line 9: `011000015 / 0401874114` (2), `011000015 / 9828958791` (1), `021001208 / 8149516692` (1).

## 9. Known limitations and open items

| Item | Status |
|---|---|
| An unknown routing number stays out of line 9 (P10, P11). The README defines line 9 as deposits "to addresses that are not associated with a known customer", which also allows the reading "any unknown destination". The samples do not settle it. | **My assumption.** If Kraken reads it the other way, line 9 comes out smaller. |
| Only `.json` files are read (P15), and the README says "all files". | **My decision.** A transaction file with another extension is ignored. |
| A transfer from one known customer to ANOTHER known customer. | **Credited to the destination.** The money reached the receiver's depository account, which is what defines a deposit. |
| A transfer between two accounts of the SAME customer (Spock → Spock). | **Open.** It is credited today, although the money only moves between accounts of the same customer. |
| An id whose first occurrence was rejected and that comes back later in a valid version. | **Credited.** The rejected occurrence is never stored, so it does not block the valid one (P12 only looks at the stored deposits). |
| An amount in scientific notation (`1e2`) or with more than 2 decimal places, even if they are zeros (`10.000`). | **Rejected on purpose** (R6). |
| A file with a BOM. | **Rejected** as invalid JSON. |
| A duplicate key in the JSON (`"amount": 10, "amount": 20`). | **No decision.** The last one wins, with no warning; it is the behaviour of `JSON.parse`. |
| Rejection reasons. | **Future work.** They are not stored; they only appear on stderr with `LOG_LEVEL=warn`. |
| Each file is loaded entirely into memory (P18). | **Accepted.** If memory runs out, the job stops without crediting anything wrong. |
| Two instances of the application at the same time against the same database (P21). | **Not supported.** The second one would erase the data of the first when it starts. `docker-compose.yml` starts only one. |
| The output of the database container is discarded (P24). | **Deliberate trade-off** so the terminal shows only the report. If the database does not start, the healthcheck fails and the application does not start. |
