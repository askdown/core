Changelog
=========

0.3.0 (????-??-??)
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
