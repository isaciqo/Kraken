-- Every valid deposit. customer_id is NULL when the destination account does
-- not belong to a known customer.
CREATE TABLE IF NOT EXISTS deposits (
    -- The transaction id sent by the banking partner, in lower case. The primary
    -- key is what guarantees a transaction is never credited twice.
    transaction_id      TEXT        PRIMARY KEY,
    customer_id         INTEGER     REFERENCES customers (customer_id),
    to_routing_number   TEXT        NOT NULL,
    to_account_number   TEXT        NOT NULL,
    from_routing_number TEXT        NOT NULL,
    from_account_number TEXT        NOT NULL,
    amount_cents        BIGINT      NOT NULL CHECK (amount_cents > 0),
    currency            TEXT        NOT NULL CHECK (currency = 'USD'),
    source_file         TEXT        NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deposits_customer_id_idx
    ON deposits (customer_id);
