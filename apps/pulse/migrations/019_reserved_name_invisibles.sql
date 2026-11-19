-- ADR-0048 decision 8, completed. 018's check compared names after folding
-- case and spacing only, so "Verified" + U+200D + " voter" passed: the
-- display-name rule allows the zero-width joiners (U+200C, U+200D), and the
-- invisible marks U+034F and the variation selectors are not format
-- characters. The check now ignores them, as `isReservedName` does. Existing
-- rows that use such a spelling are never renamed silently: the migration
-- refuses, and they are fixed by hand.
do $$
declare
  n bigint;
begin
  select count(*) into n from member_profile
   where lower(btrim(regexp_replace(
           regexp_replace(display_name, '[‌‍͏︀-️\U000E0100-\U000E01EF]', '', 'g'),
           '\s+', ' ', 'g'))) = 'verified voter';
  if n > 0 then
    raise exception '% member profile(s) use the reserved name "Verified voter"; rename or delete them, then re-run 019', n;
  end if;
end $$;
alter table member_profile drop constraint member_profile_name_not_reserved;
alter table member_profile add constraint member_profile_name_not_reserved
  check (lower(btrim(regexp_replace(
           regexp_replace(display_name, '[‌‍͏︀-️\U000E0100-\U000E01EF]', '', 'g'),
           '\s+', ' ', 'g'))) <> 'verified voter');
