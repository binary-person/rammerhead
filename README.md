# rammerhead

> proxy based on testcafe-hammerhead (password is `sharkie4life`)

Demo link: https://demo-opensource.rammerhead.org

Polished closed-source-for-now browser version: https://browser.rammerhead.org (more links by awesome community members in the discord server at the end of readme)


## Supporting me and contributing

Server infrastructure costs money and developing this project consumes a lot of my time, so I would appreciate it greatly if you become a Patreon member: https://www.patreon.com/rammerhead


## Who is this package for

Package is for those who want a fully-configurable proxy that works on many sites

## Effectiveness of proxy

This proxy supports proxying
- basically everything

## To sign in to a Google account...

You need to go through specific steps, else it will tell you that the browser is not secure.
It may ask for a CAPTCHA, you will only be able to listen to audio one.

1. In Rammerhead browser, open **classroom.google.com**
2. Then on **Sign in to Classroom**
3. A popup window will open, allowing you to sign in without any error
4. Google Classroom will now open, and your google account will be logged in. You can close Classroom, and I advise you to save the rammerhead backup to avoid the hassle of completing captcha.

## Features of proxy

The proxy allows users to create a "session". When they access their session, their localStorage and cookies will be synced with rammerhead. This allows for accurately mocking cookied requests and conveniently save their logins even if they switch devices. This also enables users to configure a custom HTTP proxy server for rammerhead to connect to for the session.

## Installing and running

Rammerhead recommends you to have at least **node v16** to be installed. Once you installed nodejs, clone the repo, then run `npm install` and `npm run build`.

After, configure your settings in [src/config.js](src/config.js). If you wish to consistently pull updates from this repo without the hassle of merging, create `config.js` in the root folder so they override the configs in `src/`.

Finally run the following to start rammerhead: `node src/server.js`

## Discord server

For any user-help non-issue related questions, especially pertaining to Rammerhead Browser, please ask them here: [Rammerhead Support Server](https://discord.gg/VNT4E7gN5Y).
