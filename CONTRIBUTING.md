# Contributing to Folio

Thanks for your interest in Folio. Bug reports and focused pull requests are welcome.

## Development

Folio requires Node.js 22 or newer.

```bash
npm install
npm run dev
```

Before opening a pull request, run:

```bash
npm run typecheck
npm run lint
npm run test:ci
npm run build
```

Keep changes focused, explain the user-facing effect, and add tests for behavior that can regress. Do not commit vault contents, generated release artifacts, local settings, credentials, or downloaded models.

By contributing, you agree that your contribution is licensed under the repository's MIT License.
