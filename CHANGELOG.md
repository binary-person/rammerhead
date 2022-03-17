## v1.1.1

- fix uncatchable connection crash errors
- avoid shuffling percent encodings
- prevent forwarding localStorage endpoint to site by referrer
- fix (un)shuffle for location.hash and location.search

## v1.1.0

- handle ECONNRESET manually
- bring back MemoryStore class for module exports
- add server option to disable localStorage syncing
- fix `RammerheadSessionFileCache` not saving cache to disk correctly
- add url encoding

## v1.0.8

- handle websocket EPIPE error
- replace hammerhead's connection reset guard with a non-crashing rammerhead's reset guard
- add missing element attr getter unrewrite
- fix url rewriting for ports 80 and 443

## v1.0.7

- disable http2 support (for proxy to destination sites) because error handling is too complicated to handle
- removed server headers `report-to` (to avoid proxy url leak) and `cross-origin-embedder-policy` (which fixes reCAPTCHA v3)

## v1.0.61

- fix logger.error undefined (caused by not fully updating arguments for httpResponse.badRequest)

## v1.0.6

- expose more utils for npm package
- show password box if needed for html demo

## v1.0.5

- expose more modules for npm package
- add support for .env files
- add `deleteUnused` config option
- fix default 3 day session delete

## v1.0.43

- revert "revert fix for fix npm package"

## v1.0.42

- add entrypoint index.js for rammerhead package
- add package-lock.json to source control

## v1.0.41

- update demo link
- fix npm package

## v1.0.4

- add support for environment variable `DEVELOPMENT`
- fix crash when fetching /deletesession with a non-existent session id

## v1.0.3

- fix stability issues with websocket

## v1.0.2

- update `testcafe-hammerhead` to `v24.5.13`

## v1.0.1

- removed multi worker and rate limiting support to defer the complexity to other more suitable platforms like Docker. See [this commit](https://github.com/binary-person/rammerhead/tree/31ac3d23f30487f0dcd14323dc029f4ceb3b235a) if you wish to see the original attempt at this.
- removed unused session cleanup (as traversing the session list forces the cache into memory)
- lots of cleanup

## v1.0.0

- Initial commit
