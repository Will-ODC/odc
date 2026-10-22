-- #259: community browsing uses one visible, newest-first range scan.
create index polls_public_listing_idx
  on polls (community, created_at desc, id collate "C" desc)
  where not hidden;
