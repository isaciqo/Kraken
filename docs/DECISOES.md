# DECISIONS

Decisions taken by me (Isaci) after the QA review of the fixtures. Each one is a rule I defined, with the reason behind it. The complete set of rules is in [REGRAS.md](REGRAS.md). It was written in Portuguese during the build session and translated into English. The consolidated description of the solution is in [SOLUTION.md](../SOLUTION.md).

## 1. The same id in upper case is the SAME deposit

**Rule:** the id is normalised to lower case before checking for duplicates and before storing it. `01AAAAAA-…` and `01aaaaaa-…` are the same transaction.

**Why:** UUIDs are case-insensitive; without this, the same deposit would be credited twice.

**Where:** `validators/transactionValidator.js`. Fixture: `02-duplicates.json`, second transaction.

## 2. Routing number with 9 digits and account number with digits only, in `to` and in `from`

**Rule:** `routing_number` has exactly 9 digits and `account_number` has digits only, in both `to` and `from`. A routing number with 8 digits in `from` rejects the transaction.

**Why:** a corrupted field makes the whole record unreliable ("when in doubt, do not credit"). The only thing we do NOT verify is the ABA check digit of the origin routing number, because that would reject legitimate money.

**Where:** `validators/transactionValidator.js`. Fixture: `04-invalid-accounts.json`.

## 3. A mismatched `transaction_count` does NOT reject the file

**Rule:** `transaction_count` is ignored; the `transactions` array is what counts. No warning in the log.

**Why:** the missing transactions are not in the file anyway; rejecting the file would only throw away the valid ones. This behaviour is intentional and must NOT be "fixed".

**Where:** `validators/transactionFileValidator.js` (the field is not checked at all). Fixture: `23-transaction-count-mismatch.json`, whose transaction is credited to Spock.

## 4. Huge deposits are rejected during validation

**Rule:** the maximum amount of a deposit is 90071992547409.91 (`Number.MAX_SAFE_INTEGER` in cents). Above that, the transaction is rejected before it reaches the database. If a customer's SUM still overflows the database column (SQLSTATE class 22 error), only that transaction is skipped, nothing of it is stored, and the job goes on.

**Why:** a value like that used to bring down the whole job, and nobody received the report.

**Where:** the limit is in `validators/transactionValidator.js`; the class 22 error is recognised in `db/client.js` (`isDataException`) and handled in `services/depositService.js`. Fixture: `07-huge-amount-then-valid.json`.

## 5. The id must be in the UUID format

**Rule:** the id has 36 characters, hexadecimal digits and hyphens, in the 8-4-4-4-12 layout. An id with a null character (`\u0000`) or with thousands of characters is rejected by this same rule; there is no extra rule for these cases.

**Why:** the UUID format already blocks both before they reach the database, where they used to bring down the job.

**Where:** `validators/transactionValidator.js`. Fixture: `03-invalid-ids.json`.

## 6. If the database goes down, the job stops in a controlled way

**Rule:** a failure of the database connection, including outside of a query (an error emitted by the connection pool), goes through the same path as the infrastructure errors: it records on stderr where it stopped (file and transaction, when there is one), closes the connections and exits with code 1, without printing the report. If the connections do not close within 5 seconds, the process exits anyway.

**Why:** before, the process died on its own, without saying where it stopped. Stopping is right; what changes is stopping in a predictable way and with a clear message.

**Where:** `db/client.js` (`pool.on('error')` and the error of the connection in use) and `index.js` (`stopAfterFailure`).

## 7. KNOWN LIMITATION: a file larger than the available memory

**Rule:** each file is loaded entirely into memory. There is no streaming and no new dependency to handle huge files.

**Why:** each file is the response of one call to the endpoint (a few KB in the samples); with Node's default memory, files of several MB are read without problems. And if memory runs out, the job stops without crediting anything wrong.

## 8. No log other than what the README asks for

**Rule:** the output shows only the 11 lines of the report. The reasons for skipped files and transactions are not shown. The only exception is the failure message of decision 6, on stderr. The output of the Postgres container is discarded as well.

**Why:** the README defines exactly what must be printed.

**Where:** `LOG_LEVEL` defaults to `error` in `config/env.js` (the reasons appear with `LOG_LEVEL=warn`, for debugging); the database `entrypoint` in `docker-compose.yml`.

## 9. Unknown fields are not validated

**Rule:** a field that is not part of the known structure (for example `status`) is ignored; the transaction is evaluated only by the known fields.

**Why:** we will not validate a field when we do not know whether it will be sent.

## 10. The database is emptied at the start of every run

**Rule:** at start-up, the application creates the tables, deletes every row of them (`TRUNCATE`) and only then seeds the customers and processes the files. This always happens, with no configuration variable. The Postgres tmpfs stays, but it is no longer the only guarantee.

**Why:** every `docker-compose up` must start from scratch. With tmpfs alone, if the database container kept running between two runs, the second one inherited the deposits of the first (verified: swapping the files in `data/` and running again mixed both results).

**Consequence:** two instances of the application against the same database at the same time are not supported: the second one would erase the data of the first. `docker-compose.yml` starts only one.

**Where:** `db/schema.js` (`emptyTables`) and `index.js`.
