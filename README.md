# rammerhead-proxy

> proxy based on testcafe-hammerhead


## Supporting me and contributing

Server infrastructure costs money and developing this project consumes a lot of my time, so I would appreciate it greatly if you become a Patreon member: https://www.patreon.com/rammerhead


## Who is this package for

Package is for those who want a fully-configurable proxy that works on many sites

## Effectiveness of proxy

This proxy supports proxying
- basically everything except google logins

## Features of proxy

The proxy allows users to create a "session". When they access their session, their localStorage and cookies will be synced with rammerhead. This allows for accurately mocking cookied requests and conveniently save their logins even if they switch devices. This also enables users to configure a custom HTTP proxy server for rammerhead to connect to for the session.

## Installing and running

Assuming you have node already installed, clone the repo, then run `npm install`.

After, configure your settings in [src/config.js](src/config.js) and [src/config2.js](src/config2.js). If you wish to consistently pull updates from this repo without the hassle of merging, create `config.js` and `config2.js` in the root folder so they override the configs in `src/`.

Finally, there are two options in starting rammerhead:

- `node src/server.js`
  - this starts the server as normal
- `node src/multi-server.js`
  - this spawns N workers and load balances automatically among them, where N is the number of CPU threads in the system. configure number of workers settings in [src/multi-config.js](src/multi-config.js)
  - try not to use this because race conditions occur when workers try to read and delete files from the session store at the same time. this can lead to unexpected behavior, like cookies randomly deciding to not work. Also, see [RammerheadSessionFilePersistentStore.js](src/RammerheadSessionFilePersistentStore.js) for a more in-depth description on the drawbacks of using this setup.
