-- Optional v2 contracts. This file is documentation/migration input; the CLI never executes DDL.
-- Populate from authoritative historical sources. Creating empty tables does not establish coverage.
CREATE TABLE index_membership_history (
    `index` String, code String, effective_date Date, publish_date Date, is_member UInt8, version UInt64
) ENGINE=ReplacingMergeTree(version) ORDER BY (`index`,code,effective_date,publish_date);
CREATE TABLE financial_revisions (
    code String, report_date Date, publish_date Date, adjusted_profit_diff Float64,
    total_shares Float64, circulating_a Float64, version UInt64
) ENGINE=ReplacingMergeTree(version) ORDER BY (code,report_date,publish_date);
CREATE TABLE stock_daily_execution (
    date Date, code String, limit_up Float64, limit_down Float64, version UInt64
) ENGINE=ReplacingMergeTree(version) ORDER BY (code,date);
-- (0,0) explicitly means no limit on that session; positive pairs are actual raw-price limits.
CREATE TABLE corporate_actions (
    code String, record_date Date, ex_date Date, pay_date Date, share_available_date Date,
    known_date Date, cash_per_share Float64, withholding_per_share Float64,
    share_ratio Float64, fractional_cash_price Float64, version UInt64
) ENGINE=ReplacingMergeTree(version) ORDER BY (code,ex_date);
-- Append-only coverage attestations, supplied only after independently auditing the source.
CREATE TABLE research_coverage (
    dataset String, start_date Date, end_date Date, verified UInt8, source String, verified_at DateTime
) ENGINE=MergeTree ORDER BY (dataset,start_date,end_date,verified_at);
