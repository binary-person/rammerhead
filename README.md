# rammerhead

> proxy based on testcafe-hammerhead

Demo link (password is sharkie4life): https://rammerhead.org


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

After, configure your settings in [src/config.js](src/config.js). If you wish to consistently pull updates from this repo without the hassle of merging, create `config.js` in the root folder so they override the configs in `src/`.

Finally, there are two options in starting rammerhead:

- `node src/server.js`
  - this starts the server as normal

## Discord server

For any user-help non-issue related questions, please ask them here: [Rammerhead Support Server](https://discord.gg/VNT4E7gN5Y).
