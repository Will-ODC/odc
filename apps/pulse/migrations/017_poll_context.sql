-- Optional plain-text background. No context is invented for existing polls.
alter table polls add column context text;
alter table polls add constraint polls_context_check check (
  context is null or (
    char_length(context) between 1 and 500
    -- PostgreSQL text already rejects NUL and invalid Unicode. LF is allowed;
    -- every other C0/C1 control, including CR, tab and DEL, is refused.
    and context !~ U&'[\0001-\0009\000B-\001F\007F-\009F]'
  )
);
