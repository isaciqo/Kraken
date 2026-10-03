# Kraken Hiring Test - Backend Engineer - Fiat Payments

At Kraken, we receive thousands of deposits from customers per day. This test is designed to test your ability to work with a transaction set that could get returned by a banking partner. A common approach to detect incoming deposits is to poll a /transactions endpoint and inspect the result.  Deposit transactions can be identified by matching their destination to a known user depository account.

This test contains 2 sample json files that represent the data from 2 separate calls to this endpoint. Your task is to write code that processes those files and detects all valid incoming deposits. Additional files will be included in the projects data directory when scoring the submission to check edge case handling.

These instructions do not specify every single detail you should take into consideration. This is done on purpose to test your ability to analyze a problem and come up with a reasonable and safe approach. Keep in mind that your code will determine how much money each customer will be credited. Thoroughness is one of the most important qualities for this role.

**Goal:** Process transactions and filter them for valid deposits.

Known customer depository accounts are:

* Jadzia Dax [{routingNumber: 011000015, accountNumber: 6622085487}]
* James T. Kirk [{routingNumber: 021001208, accountNumber: 0018423486}]
* Jean-Luc Picard [{routingNumber: 021001208, accountNumber: 1691452698}]
* Jonathan Archer [{routingNumber: 011000015, accountNumber: 3572176408}]
* Leonard McCoy [{routingNumber: 011000015, accountNumber: 8149516692}]
* Montgomery Scott [{routingNumber: 011000015, accountNumber: 7438979785}]
* Spock [{routingNumber: 011000015, accountNumber: 1690537988}, {routingNumber: 021001208, accountNumber: 1690537989}]
* Wesley Crusher [{routingNumber: 011000015, accountNumber: 6018423486}]

## Requirements

Build a dockerized Node.js application to process the two transaction sets. If you're not comfortable with Node.js, feel free to use the language of your choice.

The application must run using the command `docker-compose up`, which will be executed from the root directory of the submission. Your solution must be able to build and run properly in a fresh environment.

Transaction files should be read from the mounted directory `data` which exists in the root directory of the project.  On submission, both sample1.json and sample2.json transaction files should be present in the data directory.  Additional files will be added to the data directory when scoring the submission.

The application should read all transactions from all files in the mounted data directory and store all deposits in a database of your choice.

Transaction records credited to users should be read from the database, and the following 11 lines should be printed on stdout:

    Deposited for Jadzia Dax: count=n sum=x.xx USD
    Deposited for James T. Kirk: count=n sum=x.xx USD
    Deposited for Jean-Luc Picard: count=n sum=x.xx USD
    Deposited for Jonathan Archer: count=n sum=x.xx USD
    Deposited for Leonard McCoy: count=n sum=x.xx USD
    Deposited for Montgomery Scott: count=n sum=x.xx USD
    Deposited for Spock: count=n sum=x.xx USD
    Deposited for Wesley Crusher: count=n sum=x.xx USD
    Deposited without known user: count=n sum=x.xx USD
    Smallest valid deposit: x.xx USD
    Largest valid deposit: x.xx USD


The numbers in lines 1 - 8 MUST contain the count of valid deposits and their sum for the respective customer.

The numbers in line 9 MUST be the count and the sum of the valid deposits to addresses that are not associated with a known customer.

Results MUST be printed to stdout as formatted above.  Any submissions requiring additional steps or commands beyond executing `docker-compose up` will not be considered.  

## Submitting your results

Compress your source code as a zip archive and send us a link where we can download it. Sharing via Dropbox or Google Drive has worked well in the past. Make sure the Dockerfile is on the top level.
