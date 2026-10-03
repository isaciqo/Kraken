-- An account is identified by the PAIR routing number + account number.
-- Both are text: leading zeros are significant.
CREATE TABLE IF NOT EXISTS customer_accounts (
    routing_number TEXT    NOT NULL CHECK (routing_number ~ '^[0-9]+$'),
    account_number TEXT    NOT NULL CHECK (account_number ~ '^[0-9]+$'),
    customer_id    INTEGER NOT NULL REFERENCES customers (customer_id),
    PRIMARY KEY (routing_number, account_number)
);

CREATE INDEX IF NOT EXISTS customer_accounts_customer_id_idx
    ON customer_accounts (customer_id);
