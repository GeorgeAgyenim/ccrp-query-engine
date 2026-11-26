# Contributing

Thank you for helping. This file covers branches, commits and pull requests; [CLAUDE.md](CLAUDE.md) holds
the safety rules, conventions and testing notes, for people and AI agents alike.

## Branches

Work on a branch off `main`, named for its ticket:

- `feature/<NN>-<slug>` for new work, for example `feature/01-test-db-ci-engine-role`;
- `fix/<NN>-<slug>` for a bug fix.

`NN` is the query-engine ticket number, zero-padded to two digits; `<slug>` is a few lower-case words joined
by hyphens. Never commit straight to `main`.

## Commits

- One logical change per commit.
- Subject in the imperative, stating intent, completing "If applied, this commit will ___", for example
  `Run every engine query in a read-only transaction with a statement timeout`. No `feat:`/`fix:` prefixes.
- A body when the why is not obvious from the subject.
- The body's last line cites the ticket, the requirement IDs and the decision records the change serves, for
  example `query-engine ticket 01. FR-1.4, FR-1.6. ADR-0001, ADR-0007.`

## Pull requests

- The title or first line cites `query-engine ticket NN`.
- `npm run typecheck` and `npm test` pass (CI runs both, plus the image build).
- Docs change in the same pull request as the code: the [API reference](docs/api-reference.md), the
  [host setup guide](docs/host-setup.md), the [changelog](CHANGELOG.md) under *Unreleased*, and the
  [tools inventory](docs/tools-inventory.md) for any new or changed dependency.
- A decision that is hard to reverse (the plan format, the HTTP API, the database schema, a role or setting
  name) gets a decision record in `docs/decisions/` before it is implemented.

## Safety rules

This repository is public. The [safety rules in CLAUDE.md](CLAUDE.md#safety-rules) bind every contribution:
no instance data, credentials or personal data; instance-neutral code; SQL values as parameters; least
privilege; logs without what people sent; failing tests fixed, not silenced.

## Licence

By contributing you agree that your contribution is licensed under [GPL-3.0](LICENSE).
