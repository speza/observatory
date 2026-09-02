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
- [ ] Run Gitleaks or an equivalent dedicated scanner over the complete rewritten
      history.
- [ ] Review all tracked documentation, fixtures, test data and Git URLs for
      private names, paths, credentials, transcripts or session identifiers.
- [x] Confirm no unintended lockfiles or generated files are untracked after
      the history rewrite. Repeat this check immediately before publication.

## 3. Public project presentation

- [ ] Choose and add a project licence. Use Apache-2.0 or MIT for open-source
      reuse, or document an intentional source-visible/no-licence decision.
- [ ] Add an early-stage stability notice near the top of `README.md`.
- [ ] Add prerequisites, including the supported Bun version, Herdr requirement
      for live mode and the host-independent mock path.
- [ ] Add one strong screenshot or short recording of the synthetic mock
      portfolio near the top of `README.md`.
- [ ] Set the GitHub description, topics and social preview image.
- [ ] Review naming conflicts with other projects named Observatory and explain
      the scope clearly if retaining the name.

## 4. Public engineering baseline

- [ ] Add GitHub Actions CI for frozen dependency installation, checks, tests and
      the web build.
- [ ] Enable GitHub secret scanning and dependency alerts where available.
- [ ] Decide whether to protect `main` once the repository is public.
- [ ] Run `bun run format`.
- [ ] Run `bun run check`.
- [ ] Run `bun test`.
- [ ] Run `bun run build:web`.
- [ ] Dogfood the synthetic product with `bun run web:mock`.

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
