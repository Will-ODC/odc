/**
 * The reserved-name table (ADR-0048 decision 8), shared by the app check
 * (`isReservedName`) and the database constraint (migration 019), so both
 * are held to every case. Each spelling reads as "Verified voter".
 */
const hidingMarks = [
  0x200c, 0x200d, 0x034f, 0xfe0f, 0xe0100, 0x180b, 0x180c, 0x180d, 0x180e,
  0x180f, 0x17b4, 0x17b5, 0x1d159,
];
const blankFillers = [0x3164, 0x115f, 0x1160, 0xffa0, 0x2800];

export const RESERVED_SPELLINGS: readonly string[] = [
  "Verified voter",
  "verified voter",
  "VERIFIED   Voter",
  " verified  voter ",
  "VERIFIED \t voter\n",
  "\u200D Verified voter",
  "Verified \u200Cvoter",
  "Verified\u034F voter\uFE0F",
  "Verifiedvoter",
  "verified-voter",
  "Verified. Voter!",
  "Ver\u0130fied voter",
  "VER\u0130F\u0130ED VOTER",
  "\uFF36\uFF45\uFF52\uFF49\uFF46\uFF49\uFF45\uFF44 \uFF56\uFF4F\uFF54\uFF45\uFF52",
  ...hidingMarks.map((c) => `Verified${String.fromCodePoint(c)} voter`),
  ...hidingMarks.map((c) => `Verified voter${String.fromCodePoint(c)}`),
  ...blankFillers.map((c) => `Verified${String.fromCodePoint(c)}voter`),
  ...blankFillers.map((c) => `Verified ${String.fromCodePoint(c)} voter`),
];

/** Names that only look near it: letters, digits and symbols still count. */
export const ALLOWED_SPELLINGS: readonly string[] = [
  "Ada",
  "Verified voters",
  "Unverified voter",
  "Verified voter 2",
  "Verified voter \u2713",
  "Verified\u200D voters",
];
