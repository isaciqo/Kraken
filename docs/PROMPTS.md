# PROMPTS

Every prompt of the build session, numbered and in full. The prompts were written in Portuguese; this is the English translation. The original is in [PROMPTS.pt-BR.md](PROMPTS.pt-BR.md).

## Prompt 1

Read README.md and the files in data/. This is Kraken's backend challenge. I want you to read them to get more context.

I want you to analyse what they are asking for and write a REGRAS.md (rules) with the assumptions and rules, each one with the reason behind it. General principle: I want to be as safe as possible, and build the solution always thinking that it will be used in production, with real data, and with a deploy process. That means we will not keep state in memory; whenever possible we will go to the database, and we will always analyse it for race conditions. "When in doubt, do not credit" — crediting too much is a real loss; not crediting can be fixed later.

Assumptions I have already defined:
- The language is JavaScript (Node.js) and the database is PostgreSQL.
- An account is identified by the PAIR routing_number + account_number, never by the account_number alone. Account and routing numbers are text (leading zeros matter).
- Money is handled as integer cents in the code and BIGINT in the database, to avoid floating-point errors. USD only.
- Line 9 ("Deposited without known user") = valid deposits to accounts with no known customer. Lines 10 and 11 (smallest and largest) consider all valid deposits, including those of line 9.
- A valid deposit is one to a known routing_number. If the routing_number exists but the account number does not, it is still valid, and it goes to an unknown user.
- An id that was already processed is not processed again: the first version seen is the one that counts. Files are read in alphabetical order, so the result is deterministic.
- stdout has ONLY the 11 report lines, in the exact format. Do not create other logs or any other format.
- Every `docker-compose up` starts with an empty database: if I run it, swap the files in data/ and run it again, nothing from the previous run may appear.

Do not write code yet. Show me REGRAS.md and point out what you think is still open.

Throughout the whole session, save each of my prompts, numbered, in a PROMPTS.md.

## Prompt 2

Now create the infrastructure and the skeleton of the project. Code, comments and logs in English.

Docker:
- docker-compose.yml with Postgres 16 and the application's Node image (Node 22, Dockerfile at the root, npm ci with package-lock.json, running as the node user, data/ mounted read-only).
- The database needs a healthcheck, and the application only starts once the database is ready (depends_on with service_healthy). Use `pg_isready -h 127.0.0.1`: during initialisation Postgres starts a temporary server that only accepts local connections, and checking over the network prevents the app from connecting too early.
- Postgres must keep its data in tmpfs, with no volume, so every `docker-compose up` starts from scratch.
- It must work with `docker-compose up` alone, in a clean environment, with no manual steps.

Structure: since this is a job and not a server, it does not need a controller; even so, we will build an orchestrator following clean architecture and clean code:
- index.js: entry point (creates tables → seed → runs the job).
- jobs/: the core of the flow.
- services/: operations and business rules. They do not write SQL.
- repositories/: one per table, SQL only. They do not decide business rules.
- validators/: pure functions, no database and no files.
- helpers/: money (cents ↔ "x.xx") and logging (stderr).
- db/: client (pool + a function that runs a block inside a database transaction), seeder and schemas (.sql files with IF NOT EXISTS).
- config/: environment variables.

Database:
- customers (with customer_id, deposit_count and total_deposited_cents, always kept up to date);
- customer_accounts (keyed by the pair routing + account; if a customer has two accounts, both accounts return the same customer_id, which is used to compute the count and the deposit total);
- deposits (every valid deposit, with customer_id NULL when the account does not belong to a customer).
The deposit and the customer's total must be written in the SAME database transaction.

Clear names: method and variable names must be clear and semantically correct.

Do not implement the processing rules yet. Only set up the structure and confirm that `docker-compose up` starts the database, creates the tables and runs the seed.

## Prompt 3

Now implement the flow in the job:

1. Loop over every .json file in data/ (alphabetical order; other files are ignored).
2. File validation, in its own file in validators/: it must be valid JSON, with the "transactions" field being an array with at least 1 item. If it fails, move on to the next file. A bad file never stops the processing.
3. For each transaction, structural validation: the fields id, to, from, to/from.routing_number, to/from.account_number, amount.amount and amount.currency exist, with the correct types. If it fails, record the reason and move on to the next transaction.
4. Business rules, in this order:
   1) Is "to" the same as "from"? If so, skip.
   2) Does the id already exist in the deposits table? If so, skip.
   3) Does the destination account belong to a known customer? If so, store the deposit and add the amount and the count to the customer. If not, store the deposit without a customer (for line 9).
5. After reading everything, print the 11 lines read FROM THE DATABASE, exactly in the README format.

## Prompt 4

Now create JSON test files to validate the rules and find edge cases. I want these files to be very different from the samples.

I will list some cases and I want you to add others; for that, act as a senior QA, focusing on quality and scalability.

- Put them in test/fixtures/, OUTSIDE data/, so they do not change the result of the samples.
- Create a docker-compose.test.yml that mounts test/fixtures/ in place of data/.
- Use round values, so I can check the sums in my head.
- Use one customer as the default (e.g. Leonard McCoy): every transaction that SHOULD be rejected goes to their account. If they show up with count > 0, some rule failed.
- Ids in UUID format, prefixed with the file, so we know where each one came from.

Cover at least:
- valid: a customer with 2 accounts (Spock), similar accounts with leading zeros (Kirk × Wesley), a Kraken account with no customer, a customer's account number at ANOTHER bank, an amount that can cause floating-point problems;
- duplicates: identical id in another file, the same id in upper case, the same id with a different amount, an id repeated in the same file;
- one invalid transaction for each case: no id, empty id, numeric id, id that is not a UUID, no "to", "from" without account_number, routing with 8 digits, account with letters, amount as text, null amount, no amount, amount 1e400 (becomes Infinity), amount 0, negative amount, amount with 3 decimal places (10.005), currency EUR, lower-case currency "usd", origin equal to destination, destination at a bank that is not Kraken's, transaction that is not an object;
- files: broken JSON, no "transactions", "transactions" that is not an array, transaction_count different from the array size, a .txt file with valid JSON inside;
- a huge amount (100000000000000000) followed by a valid transaction in the same file.

Write a test/fixtures/README.md with each file, what should happen and the expected result of the 11 lines. Run it and show me the result obtained.

## Prompt 5

Run the tests and compare the result with the expected one. Do not change any code: just explain it to me.

I want a summary with:
1. What is already right.
2. What differs from the expected result, line by line of the report, and which case caused each difference.
3. Cases that are rejected WITHOUT showing up in the log.
4. A code review looking for situations nobody analysed: values that bring down the whole job, database errors in the middle of the processing, loss of precision, upper-case ids, transfers between Kraken customer accounts, files with a BOM, etc. Test it for real before claiming anything.

For each point, explain it in plain language, say what you recommend and what the pros and cons are. Make clear what is required by the README and what is your own assumption.

## Prompt 6

You can apply the following recommendations: require a UUID in the validator; compare the id in lower case; require 9 digits in "to" and "from" — add this validation as well.

This behaviour is correct: a wrong transaction_count does not reject the file.

No log other than what the README asked for may appear.

We will not validate a field when we do not know whether it will be sent (the case of "status").

These are my answers to the points you found. They are RULES I DEFINED: implement them and record them in DECISOES.md (decisions) as my decisions, each one with the reason below. If any of them is already implemented by the previous prompt, just confirm it with a test.

1. The same id in upper case (e.g. "01AAAAAA-…" and "01aaaaaa-…") is the SAME deposit.
   Rule: normalise the id to lower case before checking for duplicates and before storing it.
   Why: UUIDs are case-insensitive; without this, the same deposit would be credited twice.

2. A routing number with 8 digits in "from" must be REJECTED.
   Rule: routing_number with exactly 9 digits and account_number with digits only, in both "to" and "from".
   Why: a corrupted field makes the whole record unreliable ("when in doubt, do not credit"). The only thing we do NOT check is the ABA check digit of the origin routing number, because that would reject legitimate money.

3. A transaction_count different from the array size does NOT reject the file.
   Rule: ignore transaction_count; the transactions array is what counts. No warning in the log.
   Why: the missing transactions are not in the file anyway; rejecting the file would only throw away the valid ones. Do NOT "fix" this behaviour.

4. Huge deposits (e.g. two of 50000000000000000.00) must be REJECTED during validation, and never get to overflow the BIGINT.
   Rule: maximum amount of 90071992547409.91 (Number.MAX_SAFE_INTEGER in cents). If even so a customer's SUM overflows in the database (class 22 error), only that transaction is skipped and the job continues.
   Why: a value like that used to bring down the whole job, and nobody received the report.

5. An id with a null character (\u0000) or with thousands of characters must be REJECTED during validation.
   Rule: the id must be in UUID format (36 characters: hexadecimal digits and hyphens). Do not create an extra rule for these cases.
   Why: the UUID format already blocks both before they reach the database.

6. If the database goes down in the middle of the processing, including outside of a query (an error emitted by the connection pool), the job must STOP IN A CONTROLLED WAY.
   Rule: handle the pool's error event (pool.on('error')) and go through the same path as the infrastructure errors: record on stderr where it stopped (file and transaction, when there is one), close the connection and exit with code 1, without printing the report.
   Why: today the process dies on its own, without saying where it stopped. Stopping is right; what changes is stopping in a predictable way and with a clear message.

7. A file larger than the available memory: do NOT handle it.
   Rule: each file is loaded entirely into memory. Record it in DECISOES.md as a KNOWN LIMITATION, with no streaming and no new dependency.
   Why: each file is the response of one call to the endpoint (a few KB in the samples); with Node's default memory, files of several MB are read without problems. And if memory runs out, the job stops without crediting anything wrong.

After implementing:
- add to the fixtures the cases that are not there yet (upper-case id, 8-digit routing number in "from", mismatched transaction_count, two huge amounts for the same customer, id with \u0000, very long id) and update the expected result in the fixtures README;
- run the fixtures and the samples and compare them automatically with the expected result;
- simulate the database going down in the middle of a file and show that the job stops with code 1, with the message saying where it stopped and without the report;
- show me a summary of each of the 7 points: before × after.

## Prompt 7

Now validate everything, as if it were Kraken's evaluation:

1. Clean environment: remove the project's containers and images and run `docker-compose up` from scratch.
2. Samples: AUTOMATICALLY compare (diff) the 11 lines with the expected result. Confirm that stdout has only the 11 lines and that the samples produce no warning.
3. Fixtures: compare automatically with the expected result in test/fixtures/README.md.
4. A new environment on every run: run it, swap the files in data/ and run it again without bringing the database down; the second result must not contain anything from the first.
5. Stop on infrastructure errors: simulate a connection loss in the middle of the processing and confirm that the job stops, with code 1, and does not print the report.
6. Documentation × code: check whether DECISOES.md, the fixtures README and the comments match what the code really does. Point out any outdated comment or passage.

Show me a summary of what passed and what failed. Fix only what is an obvious error; anything that involves a decision, ask me.

## Prompt 8

Now create the unit tests.
You are allowed to use dependencies to speed up the testing process; at the end I want an analysis of the coverage, but at least these validations must be done:
- The tests must run with `npm test`, without Docker and without a database.
- Put them in test/unit/, one file per tested module.
- Cover:
  - file validator: each rejection reason;
  - transaction validator: one test per rule, including the BOUNDARIES (0.01 valid, 0 invalid; 2 decimal places valid, 3 invalid; 90071992547409.91 valid, 90071992547409.92 invalid; upper-case UUID valid; routing with 8 and 10 digits);
  - money helpers: conversion to cents and formatting, including 0.29, 0.1 and 1000.1;
  - database error classification: class 22 continues, the others stop;
  - deposit service rules (same account, duplicate, known customer, no customer), using fake repositories, without a database;
  - job: bad data from the database skips the transaction; any other error stops the job without printing the report.
- The tests must not change the behaviour of the code. If you need to change something to be able to test it, ask me first.
- Run `npm test` and show me the result. Also confirm that `docker-compose up` still works and that the tests do not get into the Docker image.
