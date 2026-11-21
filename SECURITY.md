# Security

## Reporting a problem

If you find a security problem in Shiny Knitting, please report it privately
rather than in a public issue: on the repository's **Security** tab, choose
**Report a vulnerability**. Only the maintainer sees the report.

Helpful to include: what the problem is, how to make it happen, and the
version of the app (Settings shows it).

## Versions

Fixes go into the latest release, and the app's updater offers it. Older
versions are not patched.

## What the app does with data

Everything stays on the computer: the library, the stash and the projects are
kept in a local database and folder. The app connects out only for what it is
asked to do: checking for updates on GitHub, Ravelry when signed in, web pages
added as cheatsheets or links, and a model server for describing patterns
when one is set up in Settings (off until then).
