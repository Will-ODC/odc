-- ADR-0049 (#701): share picture storage and the append-only audit table.
alter table image
  drop constraint image_owner_kind_check,
  add constraint image_owner_kind_check
    check (owner_kind in ('poll', 'community', 'contribution'));

alter table contribution add column image_id uuid unique references image (id);

alter table content_change
  drop constraint content_change_target_kind_check,
  add constraint content_change_target_kind_check
    check (target_kind in ('poll', 'community', 'contribution')),
  drop constraint content_change_action_check,
  add constraint content_change_action_check
    check (action in ('image_attach', 'image_remove', 'image_replace'));
