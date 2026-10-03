# AI Usage Declaration

In line with Kraken's AI policy, this document declares every AI tool used in this submission, where it was used, and how the work was steered and validated.

## Tools

| Tool | Used for |
|---|---|
| **Claude** (Anthropic), through **Claude Code** | Main engineering assistant: analysing the README and the data, discussing options, writing the code, the test data, the unit tests and the documentation, running the application to check results, and translating the prompt log into English |
| **Gemini** (Google) | Organising my prompts into a shorter, structured sequence, to use fewer tokens and keep the assistant's context focused |

## How I worked

### 1. Exploratory session

I started with a long, conversational session with Claude to understand the problem before committing to a design. In it I:

- asked for an analysis of the README and of what a reviewer would expect;
- researched to validate ideas and find reference approaches, such as the safest way to handle money values in JavaScript;
- discussed and decided the assumptions and rules, one by one, asking for pros and cons whenever a choice was not obvious;
- questioned the code where I disagreed (naming, where business logic should live, how balances are updated) and asked how real banking systems approach the same problems.

All business rules and assumptions in [SOLUTION.md](SOLUTION.md) are **my decisions**. The assistant proposed options and trade-offs; I chose, and in several cases rejected its suggestions (for example: ignoring `transaction_count`, not handling BOM files, not adding extra logs).

### 2. Structured build

With the decisions settled, I organised the prompts into a short sequence and built the solution with Claude in a fresh session. Every prompt is in [docs/PROMPTS.md](docs/PROMPTS.md) (English translation; the original Portuguese is in [docs/PROMPTS.pt-BR.md](docs/PROMPTS.pt-BR.md)).

| Prompt | Goal | My check |
|---|---|---|
| 1 | **Analysis for context**: read the README and the data, write down the assumptions I had already defined, no code yet | Reviewed the written assumptions and the open points |
| 2 | **Skeleton**: Docker setup (healthcheck, empty database on every run), project layers, tables and seed | Ran `docker-compose up` and confirmed the database starts, the tables are created and the customers are seeded |
| 3 | **Processing flow**: file and transaction loops, structural validation, the core deposit rules, the 11-line report read from the database | **Manual validation**: ran it and compared the 11 lines with the expected sample result |
| 4 | **Edge-case simulation**, asking the assistant to act as a senior QA: test files for the cases I listed plus others it should add, with the expected result | Ran the scenarios and checked the report against the expected result |
| 5 | **Error summary**: compare expected × actual and review the code for unanalysed situations, without changing anything | Read each finding and decided what to do |
| 6 | **My decisions**: the rules I defined in answer to the findings, each with its reason, implemented and recorded | Re-ran samples and scenarios, and the simulated database outage |
| 7 | **Full validation, as Kraken would do it**: clean environment, automatic comparison of the outputs, swapping files between runs, documentation × code | Read the pass/fail summary |
| 8 | **Unit tests**, allowing a test dependency (Jest) and asking for a coverage analysis | Ran `npm test` (369 tests, 100% coverage) |

[docs/REGRAS.md](docs/REGRAS.md) (rules, prompt 1) and [docs/DECISOES.md](docs/DECISOES.md) (decisions, prompt 6) are the working documents written during that session, translated into English. [SOLUTION.md](SOLUTION.md) is the consolidated English version of both, describing what is implemented.

## What I validated myself

- Ran `docker-compose up` after each step and checked the 11 lines against the expected result.
- Ran the edge-case scenarios and the end-to-end comparison (`node test/run-tests.js`), and used detailed logs (`LOG_LEVEL=warn`) to confirm each rejection had the right reason.
- Checked that rejected transactions never affect counts, sums, smallest or largest deposit.
- Ran the unit tests (`npm test`).
- Reviewed the code and asked for explanations of any part I did not fully understand before accepting it.

I can explain and discuss every rule and technical decision in this submission.
