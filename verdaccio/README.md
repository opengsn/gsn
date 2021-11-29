# Using local registry for testing

- in a background terminal, run `yarn verdaccio-start`
- to publish local build, use `yarn verdaccio-publish`, which will publish into this repo
  (note that it requires a clean git, and make local commit - but doesn't push anything)
- use `gsn/verdaccio/yarn` instead of normal `yarn` to initialize a test app
  - it will fetch "@opengsn" packages from our verdaccio (with a fallback to npmjs.com)
  - all other packages are fetched directly.
- (this script simply does `yarn --use-yarnrc=gsn/verdaccio/yarnrc`)
