# Contributions

Contributions give people a place to organise work, offer help, and gather
support for a stated community benefit. A contribution has its own detail
page and may link to a Pulse poll. Pulse Home lists questions and up to four recent
contributions together, newest first. Contributions carry type tags and link to
their own details.

The approved Contributions scope combines the action record in #246,
participation and progress reporting in #247, the funding pledge in #252,
and the mixed Home list in #397. Any signed-in Pulse account can publish,
up to five contributions per hour. Only the organizer can publish status
updates. Pulse owns the records and serves them through
its own API. The charter's initiative model informs the design. Core
integration is deferred under #398.

## What to test

- Browse Contributions from Home or the dedicated list.
- Sign in and publish a project, fundraiser, group buy or offer. State the
  community benefit, what is needed and the name to show as organiser.
- Offer help, record a pledge or report work. The confirmation says that the
  chosen name and message will be public.
- Publish progress or evidence as the organiser. Reviewed impact is tracked
  separately in #248.
- For a group buy or commercial offer, give the regular and offered price in
  the same currency, a comparison source and the offer terms. The initial
  threshold is 20% advertised savings.
- Optionally declare a pledged percentage of sales proceeds for a named
  collective fund. Pulse records pledges and advertised prices.
  Payment collection and investments with financial returns are future work.

Run the local demo in memory or use a disposable Postgres database.
Migration 013 adds the contribution records and idempotency data.
