# rammerhead-proxy

> proxy based on testcafe-hammerhead

## Who is this package for

Package is for those who
- don't want to

## Features of proxy



## Effectiveness of proxy

This proxy supports proxying
- react

## Installing and running

Assuming you have node already installed, clone the repo, then run `npm install`.

After, configure your settings in [src/config.js](src/config.js) and [src/config2.js](src/config2.js).

Finally, there are two options in starting rammerhead:

- `node src/server.js`
  - this starts the server as normal
- `node src/multi-server.js`
  - this spawns N workers and load balances automatically among them, where N is the number of CPU threads in the system. configure number of workers settings in [src/multi-config.js](src/multi-config.js)
  - try not to use this because race conditions occur when workers try to read and delete files from the session store at the same time. this can lead to unexpected behavior, like cookies randomly deciding to not work. Also, see [RammerheadSessionFilePersistentStore.js](src/RammerheadSessionFilePersistentStore.js) for a more in-depth description on the drawbacks of using this setup.

## Supporting me and contributing

Server infrastructure costs money, so I would appreciate it greatly if you become a Patreon member.
