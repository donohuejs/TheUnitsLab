-- Commit the Phase 4 void-refund ledger value before later constraints reference it.
alter type public.bankroll_transaction_type add value 'simulated_void';
