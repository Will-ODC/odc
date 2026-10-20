-- Finish ADR-0037's deferred identity-label rollout. Drain old API instances
-- before applying: their writes do not register newly introduced labels.
lock table voter, pending_claim, allowed_domain in access exclusive mode;
do $$
begin
  if exists (select 1 from voter where community = 'pulse-general')
    or exists (select 1 from pending_claim where community = 'pulse-general')
    or exists (select 1 from allowed_domain where community = 'pulse-general') then
    raise exception 'reserved General community key already used';
  end if;
end $$;

-- Old instances may have added labels after 005; never overwrite display names.
insert into community (id, label)
  select community, community from (
    select community from voter
    union select community from pending_claim
    union select community from allowed_domain
  ) labels where community is not null
  on conflict (id) do nothing;

alter table voter
  add constraint voter_community_fk foreign key (community) references community (id),
  add constraint voter_general_not_membership check (community <> 'pulse-general');
alter table pending_claim
  add constraint pending_claim_community_fk foreign key (community) references community (id),
  add constraint pending_claim_general_not_membership check (community <> 'pulse-general');
alter table allowed_domain
  add constraint allowed_domain_community_fk foreign key (community) references community (id),
  add constraint allowed_domain_general_not_membership check (community <> 'pulse-general');
