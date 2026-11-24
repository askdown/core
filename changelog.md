Changelog
=========

0.3.1 (????-??-??)
------------------

* Added a Test workflow that type-checks, tests and builds on every push to
  main and every pull request.
* Releases are published to the vlt registry with the npm CLI instead of `vlt
  publish`. They go live right away; only npm releases are staged.
* The publish jobs are safe to re-run: a version that is already published, or
  already staged on npm, is skipped instead of failing the job.
* Fixed publishing to the vlt registry from GitHub Actions: npm now sends the
  trusted-publishing token exchange to the vlt registry with credentials,
  instead of failing with ENEEDAUTH.


0.3.0 (2026-11-24)
------------------

* Added the `switch` question type: an on-off switch whose answer is a boolean.
  A required switch must be on, and `responseSchema()` describes it as `true`.
* Removed the `checkboxes`, `dropdown` and `textarea` type aliases. The parser
  now reports them as unknown types and names the type to use instead.
* Conformance tests use the `@askdown/spec` package instead of a vendored copy
  of the spec.
* Releases are published from GitHub Actions with trusted publishing, and
  staged on npm for approval.


0.2.0 (2026-10-12)
------------------

* Changes up to this version are in the git history.
