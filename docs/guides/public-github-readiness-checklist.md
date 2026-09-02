# Public GitHub readiness checklist

Observatory should be published as an intentionally early, actively developed
project. This checklist is the release gate for changing the GitHub repository
from private to public.

## 1. Ownership and identity

- [ ] Confirm the project complies with current and former employment IP,
      moonlighting and acceptable-use agreements.
- [x] Configure this repository to author new commits as
      `Sam Perrin <samtperrin@gmail.com>`.
- [x] Rewrite all reachable commit author and committer addresses from the work
      address to `samtperrin@gmail.com`.
- [x] Remove employer names, repositories and other employer-specific details
      from the current tree and reachable history.
- [x] Remove machine-specific absolute paths from maintained documentation and
      retained prototype evidence.
- [x] Verify every local worktree and branch after the history rewrite so old
      history cannot be pushed back accidentally.

## 2. Privacy and repository hygiene

- [x] Confirm local databases, environment files, logs, dependencies and build
      output are ignored.
- [x] Confirm committed host fixtures are synthetic or sanitised.
- [x] Perform an initial scan of tracked files and reachable Git objects for
      common credential signatures.
- [x] Run Gitleaks over the complete rewritten local history.
- [x] Review tracked documentation, fixtures, test data, email addresses, local
      paths and Git URLs for private names, credentials, transcripts or session
      identifiers.
- [x] Confirm no unintended lockfiles or generated files are untracked after
      the history rewrite. Repeat this check immediately before publication.

## 3. Public project presentation

- [x] Licence the project under Apache-2.0.
- [x] Add an experimental, early-stage stability notice near the top of
      `README.md`.
- [x] Add prerequisites, including the supported Bun version, Herdr requirement
      for live mode and the host-independent mock path.
- [x] Add the project mark and a screenshot of the synthetic mock portfolio near
      the top of `README.md`.
- [x] Set the GitHub description and topics.
- [ ] Set the GitHub social preview image from the synthetic Atlas screenshot.
- [x] Review naming conflicts with other projects named Observatory and explain
      the agent-supervision scope clearly while retaining the name.

## 4. Public engineering baseline

- [x] Add GitHub Actions CI for frozen dependency installation, checks, tests and
      the web build.
- [x] Enable GitHub dependency alerts and automated security fixes.
- [ ] Enable GitHub secret scanning and push protection after making the
      repository public; the private repository is not currently eligible.
- [x] Keep `main` unprotected while this remains a solo experimental project
      developed directly on trunk; revisit this before accepting contributors.
- [x] Run `bun run format`.
- [x] Run `bun run check`.
- [x] Run `bun test`.
- [x] Run `bun run build:web`.
- [x] Dogfood the synthetic product with `bun run web:mock` and use only its
      clean database for public imagery.

## 5. Publication

- [x] Create a private local bundle backup before rewriting history.
- [x] Recreate the private GitHub repository and push only the reviewed rewritten
      `main` history, removing the immutable pull-request ref from the old
      repository.
- [x] Reset every existing checkout and worktree to the rewritten history.
- [x] Clone the recreated remote and repeat the identity, privacy and common
      credential-signature scans.
- [ ] Change `speza/observatory` visibility from private to public.
- [ ] Verify the README, image, licence, CI and clone instructions on GitHub.
- [ ] Pin the repository on the GitHub profile and add it to relevant CV or
      portfolio material.

## Publication rule

Do not make the repository public until sections 1 and 2 are complete, a
licensing decision has been made, CI is green, and the final remote scan has no
unresolved sensitive findings. Presentation improvements may remain modest;
the project should be candidly labelled as early-stage rather than held back
for product completeness.
