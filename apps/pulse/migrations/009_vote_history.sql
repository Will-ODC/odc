-- #329: one browser's private vote history ("My votes") uses one newest-first
-- range scan. The unique (poll_id, voter_id) index leads with the poll, so
-- without this every history read scans the whole vote table.
create index vote_history_idx
  on vote (voter_id, cast_at desc, poll_id collate "C" desc);
