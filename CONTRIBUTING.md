# Contributing to next-steps

Thanks for wanting to help. next-steps is maintained by one person, so the rules below keep the work manageable.

## Start with an issue

- **Bugs:** open an issue with the bug report template. Include the version, the steps to reproduce and what you expected.
- **Ideas:** open an issue with the feature request template. Describe the problem before the solution.
- **Pull requests are accepted only after discussion.** Open an issue first and wait for the maintainer to agree to the change. A pull request that was not discussed may be closed, and the discussion moves to its issue.
- **Security problems:** do not open a public issue. Write to the address in the Contact section of the [README](README.md).

## Before you open a pull request

- Keep it to one change, the one agreed in the issue.
- Add or update tests for every change in behaviour.
- Run the checks listed in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#verification) on the mod folder:
  1. `claude plugin test .` (TypeScript tests; needs the Claude Code CLI)
  2. `tsc -p .` (needs the engine's type files: start Claude Code once with `claude --plugin-dir .` so it writes `.claude-plugin/types/`)
  3. `claude plugin validate .`
  4. `python -m unittest discover -s voiced/tests -t .` (the voice daemon, Python 3.12)
- Write the results in the pull request description.

## Conventions

- Code comments, test names, documentation and commit messages are in English.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `test:`. One logical change per commit.
- Do not commit personal paths, names, secrets or API keys. Use placeholders, as the existing tests do (`C:\Users\alice\...`).
- Do not log the voice daemon's secret, not even in tests.

## Scope

Some features are planned but not in scope yet. See the "Out of scope" section of [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#out-of-scope). Propose them in an issue first.

## License

next-steps is released under the [MIT License](LICENSE). By submitting a pull request you agree that your contribution is released under the same license.
