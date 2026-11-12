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

- Browse Contributions in the mixed Home feed or with its Contributions only filter.
- Sign in and publish a project, fundraiser, group buy or offer with a title,
  description and public organizer name.
- Open Message the organizer and send a private message. Verify that the
  organizer can read it and other visitors cannot.
- Publish progress or evidence as the organiser. Reviewed impact is tracked
  separately in #248.
  Profile pages are tracked in #576. Linking organizers and their contributions
  to those profiles, including posting and management from the owner’s profile,
  is tracked in #577.

Run the local demo in memory or use a disposable Postgres database.
Migration 013 adds contribution records. Migration 014 adds private messages and stores retry revisions.
