-- ADR-0048 decision 8, completed. 018's check folded only case and spacing,
-- so invisible characters the display-name rule allows (joiners, marks,
-- blank fillers) could hide "Verified voter". This replaces it with a
-- structural rule, the same as `isReservedName` in src/profiles/input.ts:
-- NFKC-normalize, lower-case, drop every mark (M), format character (Cf),
-- separator (Z), punctuation (P) and whitespace, and the blank fillers
-- U+3164, U+115F, U+1160, U+FFA0, U+2800 and U+1D159, then compare with
-- 'verifiedvoter'. Letters, digits and symbols are kept, so
-- "Verified voter 2" stays allowed.
--
-- PostgreSQL's regular expressions have no Unicode categories, so the
-- dropped set is written out as code point ranges, generated from Unicode
-- 16.0's tables (Node's). A test checks that every one of them is dropped by
-- `isReservedName` too, so the database never refuses a name the app allows.
-- Existing rows that the new rule reserves are never renamed silently: the
-- migration refuses, and they are fixed by hand.
--
-- Lower-casing is not lower(), which follows the database's locale (under
-- "C" it leaves U+0130 alone; under Turkish it turns I into dotless i). The
-- key maps A-Z and U+0130 to a-z and i by translate(), the same in every
-- locale. These are the only characters that, after NFKC, lower-case into
-- the letters of 'verifiedvoter' (checked over every code point), so the key
-- reaches 'verifiedvoter' exactly when the app's does.
create function pulse_reserved_name_key(name text) returns text
language sql immutable strict parallel safe
return regexp_replace(
  translate(normalize(name, nfkc),
            'ABCDEFGHIJKLMNOPQRSTUVWXYZ' || U&'\0130',
            'abcdefghijklmnopqrstuvwxyzi'),
  '[' || '\u0009-\u000D\u0020-\u0023\u0025-\u002A\u002C-\u002F\u003A-\u003B\u003F-'
       || '\u0040\u005B-\u005D\u005F\u007B\u007D\u00A0-\u00A1\u00A7\u00AB\u00AD'
       || '\u00B6-\u00B7\u00BB\u00BF\u0300-\u036F\u037E\u0387\u0483-\u0489\u055A-'
       || '\u055F\u0589-\u058A\u0591-\u05C7\u05F3-\u05F4\u0600-\u0605\u0609-\u060A'
       || '\u060C-\u060D\u0610-\u061F\u064B-\u065F\u066A-\u066D\u0670\u06D4\u06D6-'
       || '\u06DD\u06DF-\u06E4\u06E7-\u06E8\u06EA-\u06ED\u0700-\u070D\u070F\u0711'
       || '\u0730-\u074A\u07A6-\u07B0\u07EB-\u07F3\u07F7-\u07F9\u07FD\u0816-\u0819'
       || '\u081B-\u0823\u0825-\u0827\u0829-\u082D\u0830-\u083E\u0859-\u085B\u085E'
       || '\u0890-\u0891\u0897-\u089F\u08CA-\u0903\u093A-\u093C\u093E-\u094F\u0951-'
       || '\u0957\u0962-\u0965\u0970\u0981-\u0983\u09BC\u09BE-\u09C4\u09C7-\u09C8'
       || '\u09CB-\u09CD\u09D7\u09E2-\u09E3\u09FD-\u09FE\u0A01-\u0A03\u0A3C\u0A3E-'
       || '\u0A42\u0A47-\u0A48\u0A4B-\u0A4D\u0A51\u0A70-\u0A71\u0A75-\u0A76\u0A81-'
       || '\u0A83\u0ABC\u0ABE-\u0AC5\u0AC7-\u0AC9\u0ACB-\u0ACD\u0AE2-\u0AE3\u0AF0'
       || '\u0AFA-\u0AFF\u0B01-\u0B03\u0B3C\u0B3E-\u0B44\u0B47-\u0B48\u0B4B-\u0B4D'
       || '\u0B55-\u0B57\u0B62-\u0B63\u0B82\u0BBE-\u0BC2\u0BC6-\u0BC8\u0BCA-\u0BCD'
       || '\u0BD7\u0C00-\u0C04\u0C3C\u0C3E-\u0C44\u0C46-\u0C48\u0C4A-\u0C4D\u0C55-'
       || '\u0C56\u0C62-\u0C63\u0C77\u0C81-\u0C84\u0CBC\u0CBE-\u0CC4\u0CC6-\u0CC8'
       || '\u0CCA-\u0CCD\u0CD5-\u0CD6\u0CE2-\u0CE3\u0CF3\u0D00-\u0D03\u0D3B-\u0D3C'
       || '\u0D3E-\u0D44\u0D46-\u0D48\u0D4A-\u0D4D\u0D57\u0D62-\u0D63\u0D81-\u0D83'
       || '\u0DCA\u0DCF-\u0DD4\u0DD6\u0DD8-\u0DDF\u0DF2-\u0DF4\u0E31\u0E34-\u0E3A'
       || '\u0E47-\u0E4F\u0E5A-\u0E5B\u0EB1\u0EB4-\u0EBC\u0EC8-\u0ECE\u0F04-\u0F12'
       || '\u0F14\u0F18-\u0F19\u0F35\u0F37\u0F39-\u0F3F\u0F71-\u0F87\u0F8D-\u0F97'
       || '\u0F99-\u0FBC\u0FC6\u0FD0-\u0FD4\u0FD9-\u0FDA\u102B-\u103E\u104A-\u104F'
       || '\u1056-\u1059\u105E-\u1060\u1062-\u1064\u1067-\u106D\u1071-\u1074\u1082-'
       || '\u108D\u108F\u109A-\u109D\u10FB\u115F-\u1160\u135D-\u1368\u1400\u166E'
       || '\u1680\u169B-\u169C\u16EB-\u16ED\u1712-\u1715\u1732-\u1736\u1752-\u1753'
       || '\u1772-\u1773\u17B4-\u17D6\u17D8-\u17DA\u17DD\u1800-\u180F\u1885-\u1886'
       || '\u18A9\u1920-\u192B\u1930-\u193B\u1944-\u1945\u1A17-\u1A1B\u1A1E-\u1A1F'
       || '\u1A55-\u1A5E\u1A60-\u1A7C\u1A7F\u1AA0-\u1AA6\u1AA8-\u1AAD\u1AB0-\u1ACE'
       || '\u1B00-\u1B04\u1B34-\u1B44\u1B4E-\u1B4F\u1B5A-\u1B60\u1B6B-\u1B73\u1B7D-'
       || '\u1B82\u1BA1-\u1BAD\u1BE6-\u1BF3\u1BFC-\u1BFF\u1C24-\u1C37\u1C3B-\u1C3F'
       || '\u1C7E-\u1C7F\u1CC0-\u1CC7\u1CD0-\u1CE8\u1CED\u1CF4\u1CF7-\u1CF9\u1DC0-'
       || '\u1DFF\u2000-\u2043\u2045-\u2051\u2053-\u2064\u2066-\u206F\u207D-\u207E'
       || '\u208D-\u208E\u20D0-\u20F0\u2308-\u230B\u2329-\u232A\u2768-\u2775\u27C5-'
       || '\u27C6\u27E6-\u27EF\u2800\u2983-\u2998\u29D8-\u29DB\u29FC-\u29FD\u2CEF-'
       || '\u2CF1\u2CF9-\u2CFC\u2CFE-\u2CFF\u2D70\u2D7F\u2DE0-\u2E2E\u2E30-\u2E4F'
       || '\u2E52-\u2E5D\u3000-\u3003\u3008-\u3011\u3014-\u301F\u302A-\u3030\u303D'
       || '\u3099-\u309A\u30A0\u30FB\u3164\uA4FE-\uA4FF\uA60D-\uA60F\uA66F-\uA67E'
       || '\uA69E-\uA69F\uA6F0-\uA6F7\uA802\uA806\uA80B\uA823-\uA827\uA82C\uA874-'
       || '\uA877\uA880-\uA881\uA8B4-\uA8C5\uA8CE-\uA8CF\uA8E0-\uA8F1\uA8F8-\uA8FA'
       || '\uA8FC\uA8FF\uA926-\uA92F\uA947-\uA953\uA95F\uA980-\uA983\uA9B3-\uA9CD'
       || '\uA9DE-\uA9DF\uA9E5\uAA29-\uAA36\uAA43\uAA4C-\uAA4D\uAA5C-\uAA5F\uAA7B-'
       || '\uAA7D\uAAB0\uAAB2-\uAAB4\uAAB7-\uAAB8\uAABE-\uAABF\uAAC1\uAADE-\uAADF'
       || '\uAAEB-\uAAF1\uAAF5-\uAAF6\uABE3-\uABED\uFB1E\uFD3E-\uFD3F\uFE00-\uFE19'
       || '\uFE20-\uFE52\uFE54-\uFE61\uFE63\uFE68\uFE6A-\uFE6B\uFEFF\uFF01-\uFF03'
       || '\uFF05-\uFF0A\uFF0C-\uFF0F\uFF1A-\uFF1B\uFF1F-\uFF20\uFF3B-\uFF3D\uFF3F'
       || '\uFF5B\uFF5D\uFF5F-\uFF65\uFFA0\uFFF9-\uFFFB\U00010100-\U00010102'
       || '\U000101FD\U000102E0\U00010376-\U0001037A\U0001039F\U000103D0\U0001056F'
       || '\U00010857\U0001091F\U0001093F\U00010A01-\U00010A03\U00010A05-\U00010A06'
       || '\U00010A0C-\U00010A0F\U00010A38-\U00010A3A\U00010A3F\U00010A50-'
       || '\U00010A58\U00010A7F\U00010AE5-\U00010AE6\U00010AF0-\U00010AF6'
       || '\U00010B39-\U00010B3F\U00010B99-\U00010B9C\U00010D24-\U00010D27'
       || '\U00010D69-\U00010D6E\U00010EAB-\U00010EAD\U00010EFC-\U00010EFF'
       || '\U00010F46-\U00010F50\U00010F55-\U00010F59\U00010F82-\U00010F89'
       || '\U00011000-\U00011002\U00011038-\U0001104D\U00011070\U00011073-'
       || '\U00011074\U0001107F-\U00011082\U000110B0-\U000110C2\U000110CD'
       || '\U00011100-\U00011102\U00011127-\U00011134\U00011140-\U00011143'
       || '\U00011145-\U00011146\U00011173-\U00011175\U00011180-\U00011182'
       || '\U000111B3-\U000111C0\U000111C5-\U000111CF\U000111DB\U000111DD-'
       || '\U000111DF\U0001122C-\U0001123E\U00011241\U000112A9\U000112DF-\U000112EA'
       || '\U00011300-\U00011303\U0001133B-\U0001133C\U0001133E-\U00011344'
       || '\U00011347-\U00011348\U0001134B-\U0001134D\U00011357\U00011362-'
       || '\U00011363\U00011366-\U0001136C\U00011370-\U00011374\U000113B8-'
       || '\U000113C0\U000113C2\U000113C5\U000113C7-\U000113CA\U000113CC-\U000113D0'
       || '\U000113D2\U000113D4-\U000113D5\U000113D7-\U000113D8\U000113E1-'
       || '\U000113E2\U00011435-\U00011446\U0001144B-\U0001144F\U0001145A-'
       || '\U0001145B\U0001145D-\U0001145E\U000114B0-\U000114C3\U000114C6'
       || '\U000115AF-\U000115B5\U000115B8-\U000115D7\U000115DC-\U000115DD'
       || '\U00011630-\U00011643\U00011660-\U0001166C\U000116AB-\U000116B7'
       || '\U000116B9\U0001171D-\U0001172B\U0001173C-\U0001173E\U0001182C-'
       || '\U0001183B\U00011930-\U00011935\U00011937-\U00011938\U0001193B-'
       || '\U0001193E\U00011940\U00011942-\U00011946\U000119D1-\U000119D7'
       || '\U000119DA-\U000119E0\U000119E2\U000119E4\U00011A01-\U00011A0A'
       || '\U00011A33-\U00011A39\U00011A3B-\U00011A47\U00011A51-\U00011A5B'
       || '\U00011A8A-\U00011A9C\U00011A9E-\U00011AA2\U00011B00-\U00011B09'
       || '\U00011BE1\U00011C2F-\U00011C36\U00011C38-\U00011C3F\U00011C41-'
       || '\U00011C45\U00011C70-\U00011C71\U00011C92-\U00011CA7\U00011CA9-'
       || '\U00011CB6\U00011D31-\U00011D36\U00011D3A\U00011D3C-\U00011D3D'
       || '\U00011D3F-\U00011D45\U00011D47\U00011D8A-\U00011D8E\U00011D90-'
       || '\U00011D91\U00011D93-\U00011D97\U00011EF3-\U00011EF8\U00011F00-'
       || '\U00011F01\U00011F03\U00011F34-\U00011F3A\U00011F3E-\U00011F4F\U00011F5A'
       || '\U00011FFF\U00012470-\U00012474\U00012FF1-\U00012FF2\U00013430-'
       || '\U00013440\U00013447-\U00013455\U0001611E-\U0001612F\U00016A6E-'
       || '\U00016A6F\U00016AF0-\U00016AF5\U00016B30-\U00016B3B\U00016B44'
       || '\U00016D6D-\U00016D6F\U00016E97-\U00016E9A\U00016F4F\U00016F51-'
       || '\U00016F87\U00016F8F-\U00016F92\U00016FE2\U00016FE4\U00016FF0-\U00016FF1'
       || '\U0001BC9D-\U0001BCA3\U0001CF00-\U0001CF2D\U0001CF30-\U0001CF46'
       || '\U0001D159\U0001D165-\U0001D169\U0001D16D-\U0001D182\U0001D185-'
       || '\U0001D18B\U0001D1AA-\U0001D1AD\U0001D242-\U0001D244\U0001DA00-'
       || '\U0001DA36\U0001DA3B-\U0001DA6C\U0001DA75\U0001DA84\U0001DA87-\U0001DA8B'
       || '\U0001DA9B-\U0001DA9F\U0001DAA1-\U0001DAAF\U0001E000-\U0001E006'
       || '\U0001E008-\U0001E018\U0001E01B-\U0001E021\U0001E023-\U0001E024'
       || '\U0001E026-\U0001E02A\U0001E08F\U0001E130-\U0001E136\U0001E2AE'
       || '\U0001E2EC-\U0001E2EF\U0001E4EC-\U0001E4EF\U0001E5EE-\U0001E5EF'
       || '\U0001E5FF\U0001E8D0-\U0001E8D6\U0001E944-\U0001E94A\U0001E95E-'
       || '\U0001E95F\U000E0001\U000E0020-\U000E007F\U000E0100-\U000E01EF'
       || ']',
  '', 'g');

do $$
declare
  n bigint;
begin
  select count(*) into n from member_profile
   where pulse_reserved_name_key(display_name) = 'verifiedvoter';
  if n > 0 then
    raise exception '% member profile(s) use the reserved name "Verified voter"; rename or delete them, then re-run 019', n;
  end if;
end $$;
alter table member_profile drop constraint member_profile_name_not_reserved;
alter table member_profile add constraint member_profile_name_not_reserved
  check (pulse_reserved_name_key(display_name) <> 'verifiedvoter');
