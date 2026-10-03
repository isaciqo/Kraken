# Solution — Kraken Fiat Payments

> **Start here.** This submission has two documents to read, in this order:
>
> 1. **SOLUTION.md** (this file): how the solution works, the assumptions it is built on, and the reasoning behind each rule and technical choice.
> 2. **[AI_USAGE.md](AI_USAGE.md)**: which AI tools were used, where, and how the work was steered and validated.
>
> Everything in [docs/](docs/) is supporting material and is not needed to evaluate the solution: the original challenge statement, the full prompt log and the working notes of the build session.

**Guiding principle: when in doubt, do not credit.** This code decides how much money each customer receives. Crediting too much is a real loss that is hard to reverse; not crediting can be fixed later by a manual review. Every rule below leans to the safe side: anything that fails a rule is simply not credited.

I approached this task as if it were a real service going to production, to stay as close as possible to what I would find working at Kraken. That is why every number in the report comes from the database, writes are atomic, and the code is safe against two runs processing the same data at the same time.

---

## 1. How to run

```
docker-compose up
```

That is the only command needed. The database starts empty on every run, the app processes every `.json` file in `data/`, and the 11 report lines are printed to stdout. Nothing else is printed in a normal run.

### Tests

| What | Command | Needs |
|---|---|---|
| **Unit tests** (with coverage) | `npm install` then `npm test` | Node.js 22+. No Docker, no database |
| **End-to-end**: runs the app on `data/` and on `test/fixtures/` and compares stdout, byte by byte, with `test/expected/` | `node test/run-tests.js` | Node.js 22+ and Docker |
| **Edge-case scenarios only**, by hand | `docker-compose -f docker-compose.yml -f docker-compose.test.yml up --build` | Docker |

`node_modules/` is not part of the submission: `npm install` creates it for the unit tests, and the Docker image installs its own dependencies with `npm ci`.

To see why each file or transaction was skipped, set `LOG_LEVEL=warn` on the `app` service (section 6).

---

## 2. Assumptions (the ground truths of this solution)

The README intentionally leaves details open. These are the facts I assumed to be true and built the program on. If any of them is wrong, the matching rule is the one to revisit.

| # | Assumption | Basis |
|---|---|---|
| A1 | `011000015` and `021001208` are **Kraken's banks**. | They are the only routing numbers used by the known customer accounts. |
| A2 | An account is identified by the **pair** `routing_number + account_number`, never by the account number alone. | In the data, McCoy's account number also appears at a different Kraken bank (`021001208`). That is a different account, even though the account number is the same as McCoy's, so it is not credited to him. |
| A3 | Routing and account numbers are **strings**, never numbers. | Leading zeros matter: `0018423486` (Kirk) and `6018423486` (Wesley) are different accounts. |
| A4 | The files are responses from a bank's `/transactions` endpoint, so they can contain money **leaving** Kraken, not only deposits. | A bank statement shows both incoming and outgoing movements. Only money arriving at a Kraken bank is a deposit. |
| A5 | The **same transaction can appear in more than one file**. | The files are separate calls to the same endpoint; polling endpoints commonly return overlapping results. |
| A6 | The transaction `id` is a **UUID** and uniquely identifies a transaction. | Every id in the samples is a UUID. UUIDs are case-insensitive. |
| A7 | Only **USD** is expected. | The report is in USD and there is no exchange rate to convert other currencies.\* |
| A8 | "Deposited without known user" (line 9) means **valid deposits that reached a Kraken bank but whose account belongs to no known customer**. | The README calls them *valid deposits to addresses not associated with a known customer*. Whether money reached a Kraken bank is decided by the destination **routing number** (A1); the full pair routing + account then decides whether there is a known customer (A2). |
| A9 | Smallest and largest deposit (lines 10–11) consider **all** valid deposits, **including deposits to unknown customer accounts** (line 9). | The README calls unknown-customer deposits *valid deposits* too. |
| A10 | A transfer from one known customer to **another** (e.g. Kirk → Picard) is a **deposit for the receiver**. | The money arrived at the receiver's depository account, which is what defines a deposit. |
| A11 | The sample files are clean on purpose; the hidden scoring files contain the edge cases. | README: *"Additional files will be included… to check edge case handling."* All 45 sample transactions are valid. |
| A12 | Each `docker-compose up` must reflect **only the files currently in `data/`**. | If files are swapped between runs, results from the previous run must not leak into the new report. |
| A13 | stdout is checked for the exact 11-line format. | The README requires that exact format; anything else on stdout could break that check. |

\* Currency validation follows clean-code principles: the accepted currency is a single rule in the transaction validator. Accepting another currency would only require adding it to that rule and adding the conversion logic to USD; no other part of the flow would change.

---

## 3. What counts as a deposit

The **destination** (`to`) decides, always comparing the pair routing + account (A2).

| Destination | Classification |
|---|---|
| Kraken bank + a customer's account | **Customer deposit** (lines 1–8) |
| Kraken bank + account with no known customer | **Deposit without known user** (line 9) |
| Any other bank | **Not a deposit** (money leaving Kraken). Excluded from the whole report |

**How "Kraken bank" is decided:** a routing number is a Kraken bank when at least one known customer account uses it. The list is not hard-coded: it comes from the customer accounts stored in the database, so adding a customer at a new bank automatically makes that bank known.

---

## 4. Rules

### 4.1 Per file

| Rule | Behaviour | Why |
|---|---|---|
| Only files ending in `.json` (lower case), directly inside `data/` | Other extensions (including `.JSON`) and subdirectories are ignored | They are not endpoint responses |
| Invalid JSON (broken, empty, or starting with a BOM) | File skipped, **next file is processed** | One bad file must not stop the others |
| Root is not an object; `transactions` missing, not an array or empty | File rejected | Unexpected format |
| Alphabetical order (plain code-unit comparison, independent of the machine's locale) | Files are always read in the same order | Deterministic result: when an id repeats, the same version always wins |
| `transaction_count` | **Ignored**; the `transactions` array is what counts | If it differs, the missing transactions are not in the file anyway; rejecting the file would only discard the valid ones |

### 4.2 Per transaction: structure (validator, pure function)

The first failing rule rejects the transaction.

| # | Rule | Why |
|---|---|---|
| V1 | The transaction must be a JSON **object** | Text, numbers, `null`, booleans or arrays are not transactions |
| V2 | `id` must be a string in the **UUID** format (36 characters, 8-4-4-4-12 hexadecimal). Upper and lower case are equivalent: the id is lower-cased before it is compared or stored | The id is what prevents double crediting. `ABC…` and `abc…` are the same UUID. The format also blocks ids with null characters or thousands of characters before they reach the database |
| V3 | `to` and `from` must be objects with `routing_number` and `account_number` as **strings** | A number has already lost its leading zeros (A3) |
| V4 | `routing_number` has **exactly 9 digits**, on both `to` and `from` | US routing numbers always have 9 digits. Any other length means corrupted data (e.g. a lost leading zero) |
| V5 | `account_number` has **digits only** (no spaces, letters, hyphens or line breaks), on both `to` and `from` | Anything else means corrupted data |
| V6 | `amount.amount` must be a JSON **number** (not text, `null`, boolean, array or object), written as a plain decimal: digits, optionally followed by a dot and **at most 2 decimal places**. No sign, no exponent | `10.005` is rejected, **never silently rounded** to `10.01`. Fractional cents do not exist in USD |
| V7 | Amount **greater than zero** | Zero or negative is not a deposit (it could be a debit or reversal) |
| V8 | Maximum amount of **90071992547409.91** | One huge value (e.g. `100000000000000000`) used to crash the whole run. With this limit a single deposit can never overflow the database column. The value is `Number.MAX_SAFE_INTEGER` cents, so every accepted amount is also exactly representable as a JavaScript number |
| V9 | `amount.currency` is exactly `"USD"` | No currency conversion. `EUR`, lower-case `usd`, `"USD "` with a space and others are rejected |

**No minimum deposit.** The README gives no basis for one, and an invented minimum could reject legitimate money.

**No ABA check-digit validation on the origin routing number.** Most origin routing numbers in the samples fail that check; enforcing it would reject legitimate deposits.

### 4.3 Per transaction: deposit rules (service)

Applied in this order to every structurally valid transaction:

1. **Origin equals destination** (same pair) → skipped. A transfer to the same account brings no new money; repeated, it would inflate the balance for free.
2. **Destination is not a Kraken bank** → skipped: not a deposit (section 3).
3. **Already processed** (same id) → skipped (section 4.4).
4. **Known customer?** → the deposit is stored and the customer's count and sum are updated. Otherwise the deposit is stored without a customer (line 9).

### 4.4 Duplicates

The `id` is unique. **The first stored version wins**: an id already stored is skipped, whether it repeats in the same file or in another one, in upper or lower case, and whether the content is identical or different.

Why: separate calls to the same endpoint can return the same transaction (A5). Processing it again would pay twice.

"Is this id already stored?" and the insert are **one atomic statement** (`INSERT … ON CONFLICT DO NOTHING` on the primary key). Checking first and inserting later would let two concurrent runs both see "not stored" and both credit the customer.

An occurrence that was rejected (for example, a corrupted version of the transaction) is never stored, so it does not block a later valid occurrence of the same id.

---

## 5. Error handling

| Type | Example | Reaction | Why |
|---|---|---|---|
| **Transaction data** rejected by the database (PostgreSQL error class `22`, *data exception*) | A customer's total would no longer fit the column | Roll back only that transaction and **continue** | The problem is in that one transaction |
| **Anything else** | Connection lost (during a query, or while idle in the connection pool), disk full, timeout, a bug | Log on stderr where it stopped (file and transaction), close the connections and **stop everything**: exit code 1, no report | It would affect every following transaction. Continuing would print an **incomplete report that looks correct**, which is worse than no report |

If the database does not answer while the connections are closed, the process exits anyway after 5 seconds.

Stopping is safe: every run starts from an empty database, so the fix is to address the cause and run again.

---

## 6. Report and output

The 11 lines are read **from the database**, as required, and printed to **stdout**.

| Lines | Source |
|---|---|
| 1–8 | Running total per known customer, in the README order. A customer with no deposits is printed with `count=0 sum=0.00` |
| 9 | Count and sum of valid deposits with no known customer |
| 10–11 | Smallest and largest of **all** valid deposits, including line 9. `0.00` if there are none, to keep the format |

All numbers are read inside one `REPEATABLE READ` database transaction, so the 11 lines describe the same snapshot of the data.

**Only these 11 lines are printed.** In a normal run, nothing else reaches the terminal:
- skipped files and transactions are not logged;
- the database container's own output is discarded in `docker-compose.yml`;
- the only other output is the error message on stderr when the whole run fails (section 5).

`LOG_LEVEL` controls what the app writes to stderr, for debugging:

| `LOG_LEVEL` | Shows |
|---|---|
| `error` (default) | Only the failure that stops the run |
| `warn` | Also every skipped file and transaction, with the reason |
| `info` | Also every credited deposit and the start-up steps |
| `silent` | Nothing |

---

## 7. Technical choices

| Choice | Why |
|---|---|
| **Node.js 22 + PostgreSQL 16** | Node is the language suggested by the README; PostgreSQL offers transactions and 64-bit integers, the standard for financial data. Node 22 is required to read the original text of JSON numbers (below) |
| **One runtime dependency** (`pg`); Jest only for tests | Less dependencies, less surface for failure. Jest is a development dependency and never enters the Docker image |
| **Money never passes through a floating-point number.** The JSON is parsed keeping the **original text** of every number (`"724.6"`), and that text is converted directly into integer cents with `BigInt` | Floating point is inexact (`0.1 + 0.2 = 0.30000000000000004`, `1.15 * 100 = 114.99999999999999`). Working on the text, every amount and every sum is exact. It is also what makes `10.005` detectable instead of rounded |
| **`BIGINT` in the database**, read back as text and formatted with `BigInt` | Exact up to about 92 quadrillion USD. Totals can exceed the per-deposit maximum safely |
| **`deposits` table** holds every valid deposit, with `customer_id = NULL` when there is no known customer | One place for the duplicate check, for line 9 and for the min/max |
| **Totals kept on `customers`** (`deposit_count`, `total_deposited_cents`) | Lines 1–8 are a simple read, like a real service that keeps balances up to date |
| **Deposit and customer total written in the same database transaction**; the total is incremented inside the `UPDATE` | Either both are saved or neither, so the total never drifts from the sum of deposits. Incrementing in the `UPDATE` means concurrent deposits never overwrite each other |
| **`customer_accounts` keyed by the pair** routing + account | Enforces A2, allows several accounts per customer (Spock has 2) and uses the key index for lookups |
| **Database constraints** (`CHECK` on positive amounts, `USD` only, digit-only account numbers, non-negative totals) | A second line of defence: even a bug in the code cannot store an invalid deposit |
| **Every run starts from an empty database**: PostgreSQL data in `tmpfs` (memory, no volume) **and** the tables are emptied at start-up | `tmpfs` covers a fresh database container; emptying the tables covers a container left running by a previous `up` (A12) |
| **Tables created from `.sql` files** with `IF NOT EXISTS`, under an advisory lock | Readable, versioned schema. The lock stops two instances starting at the same time from failing each other |
| **Healthcheck over TCP** (`pg_isready -h 127.0.0.1`) + `depends_on: service_healthy` | During first-time init PostgreSQL runs a temporary local-only server; checking over TCP prevents the app from connecting too early |
| **`package-lock.json` + `npm ci --omit=dev`**, container runs as `node`, `data/` mounted read-only, `test/` and docs excluded from the image | Reproducible build, smallest image, no privileges the app does not need |

### Code structure

```
src/
├── index.js                          entry point: create tables → empty them → seed customers → run the job;
│                                     single exit path for failures
├── jobs/depositProcessingJob.js      orchestrates: list files → validate → process → print the report
├── services/
│   ├── depositService.js             deposit rules (section 4.3); never writes SQL
│   └── depositReportService.js       builds the 11 lines from the database
├── repositories/                     one per table, SQL only, no business rules
├── validators/
│   ├── transactionFileValidator.js   file rules (pure function)
│   └── transactionValidator.js       transaction structure rules (pure function)
├── helpers/
│   ├── json.js                       JSON parsing that keeps the original text of numbers
│   ├── money.js                      decimal text → cents, cents → "x.xx"
│   └── logger.js                     stderr logging with levels
├── db/                               connection pool, database transactions, error classification,
│                                     schema files, seeder
└── config/env.js                     environment variables, validated at start-up
```

Flow of calls: `index → job → services → repositories → database`. Validators and helpers never touch the database or the file system, so every rule can be tested in isolation. There is no controller because this is a job, not an API.

---

## 8. Testing

### Edge-case scenarios (`test/fixtures/`)

20 files designed to break the rules, documented case by case in [test/fixtures/README.md](test/fixtures/README.md):

- **Valid traps:** a customer with two accounts, accounts that differ only by leading zeros, a customer's account number at the other bank, floating-point traps (`0.1 + 0.2`, `1.15`), the maximum accepted amount.
- **Duplicates:** identical id in another file, the same id in upper case, the same id with a different amount, the same id three times in one file.
- **One invalid transaction per rule:** 16 kinds of bad id, 26 kinds of bad account, 24 kinds of bad amount or currency, transfers to the same account or to a non-Kraken bank, transactions that are not objects.
- **Bad files:** broken JSON, empty file, BOM, missing or non-array `transactions`, root array, wrong extensions, a directory named `*.json`, and a valid file read after all of them.
- **Extremes:** values above the maximum, followed by a valid transaction in the same file; 5,000 transactions in one file.

Two "canaries" make any rule failure visible in the report: every transaction that must be rejected targets **Leonard McCoy** (expected `count=0`), and corrupted destination accounts would land on line 9 (expected exactly `count=6`).

### End-to-end (`node test/run-tests.js`)

Runs `docker-compose up` against the samples and against the fixtures and checks, for each one: exit code `0`, **empty stderr**, and stdout **byte-for-byte equal** to `test/expected/samples.txt` and `test/expected/fixtures.txt`.

### Unit tests (`npm install`, then `npm test`)

- **Jest**, with coverage: **14 suites, 369 tests, 100% coverage** of statements, branches, functions and lines.
- One test file per module in `test/unit/`, mirroring `src/`.
- No Docker and no database: the repositories, the connection pool and the file system are replaced by fakes.
- Covered, among others: every rejection reason of both validators, including the boundaries (`0.01` valid / `0` invalid; 2 decimals valid / 3 invalid; `90071992547409.91` valid / `.92` invalid; upper-case UUID valid; routing numbers with 8 and 10 digits); money conversion and formatting (`0.29`, `0.1`, `1000.1`); error classification (class `22` continues, anything else stops); the deposit rules with fake repositories; and the job's continue-or-stop behaviour, including that the report is never printed after a failure.

---

## 9. Known limitations and open items

| Item | Status |
|---|---|
| Transfers between two accounts of the **same** customer (e.g. Spock → Spock) | **Open.** Currently credited as a deposit. The money does not enter Kraken, it only moves between the customer's own accounts |
| Table of rejected transactions with reason and original JSON | **Future work.** Rejections are not stored; their reasons are only visible with `LOG_LEVEL=warn` |
| Amounts written in exponent notation (`1e2`) or with more than 2 decimal places even if they are zeros (`10.000`) | **Rejected on purpose** (strict format). Common JSON serializers do not write money amounts this way |
| Files with a UTF-8 BOM | **Rejected** as invalid JSON |
| Each file is loaded entirely into memory | **Accepted.** Each file is one endpoint response (a few KB in the samples); streaming would add a dependency and complexity for an unlikely case. If memory runs out, the run stops without crediting anything wrong |
| The database container's output is discarded | **Trade-off** to keep the terminal limited to the report. If the database cannot start, the healthcheck fails and the app does not start |
