## v1.0.1

- removed multi worker and rate limiting support to defer the complexity to other more suitable platforms like Docker. See [this commit](https://github.com/binary-person/rammerhead/tree/31ac3d23f30487f0dcd14323dc029f4ceb3b235a) if you wish to see the original attempt at this.
- removed unused session cleanup (as traversing the session list forces the cache into memory)
- lots of cleanup

## v1.0.0

- Initial commit
