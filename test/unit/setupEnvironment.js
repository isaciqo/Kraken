'use strict';

// Runs before every unit test file. config/env reads the environment when it
// is first required, so the variables it needs must exist beforehand. Nothing
// here points to a real database: the unit tests never open a connection.

process.env.DATABASE_HOST = 'unit-test-host';
process.env.DATABASE_PORT = '5432';
process.env.DATABASE_USER = 'unit-test-user';
process.env.DATABASE_PASSWORD = 'unit-test-password';
process.env.DATABASE_NAME = 'unit-test-database';
process.env.DATA_DIRECTORY = '/unit-test-data-directory';
process.env.LOG_LEVEL = 'silent';
