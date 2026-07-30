# Contributing to fulgurlab

fulgurlab is pure TypeScript/JavaScript: `npm --prefix web install`, then `npm test`
(engine + app), `npm run typecheck` and `npm run build` before opening a PR. There is
no Java toolchain to set up. New elements go in `web/engine/src/elements/` and must be
registered in `web/engine/src/core/factory.ts` (the dump-id coverage gate in
`web/engine/test/dump-id-coverage.test.ts` will tell you if you forget) and offered in
`web/app/src/palette/palette.ts` (likewise `palette.test.ts`).

The guidance below is inherited from upstream CircuitJS1 and still applies.

## Upstream conventions
## Raising issues
Please feel free to add issues for feature requests or bug reports. We do work on this in our spare time, for free, so the issues
that get processed tend to be the ones that are of most interest to us or scratch itches that we share.
### Labeling issues
Please start your issue titles with "Bug-" for bug reports or "Feature-" for feature requests.

Please only include one item in each issue (ie don't say "I would like this feature, and THIS feature and THAT feature" in one issue).

For bug reports please include an example circuit (or a link to one) that exhibits the bug and the steps to reproduce the bug.

For feature requests please explain why you would find this feature useful - what new work-flow would it support or what type of application would it assist with
