CREATE TABLE IF NOT EXISTS customers (
    customer_id           INTEGER PRIMARY KEY,
    name                  TEXT    NOT NULL UNIQUE,
    -- Running totals of the customer's valid deposits. Updated in the same
    -- transaction that inserts each deposit.
    deposit_count         BIGINT  NOT NULL DEFAULT 0 CHECK (deposit_count >= 0),
    total_deposited_cents BIGINT  NOT NULL DEFAULT 0 CHECK (total_deposited_cents >= 0)
);
