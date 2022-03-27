# rammerhead

> proxy based on testcafe-hammerhead (default password is `sharkie4life`, this can be edited in [src/config.js](src/config.js), `null` is disabled)

Demo link: https://demo-opensource.rammerhead.org


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

Rammerhead requires you to have at least **node v16** to be installed. After that is installed, clone the repo, then run `npm install` and `npm run build`.

After, configure your settings in [src/config.js](src/config.js). If you wish to consistently pull updates from this repo without the hassle of merging, create `config.js` in the root folder so they override the configs in `src/`.

Finally run the following to start rammerhead: `node src/server.js`

## Deploy Rammerhead
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https%3A%2F%2Fgithub.com%2Fbinary-person%2Frammerhead)
[![Deploy to Heroku](https://raw.githubusercontent.com/BinBashBanana/deploy-buttons/master/buttons/remade/heroku.svg)](https://heroku.com/deploy/?template=https://github.com/binary-person/rammerhead)
[![Run on Replit](https://raw.githubusercontent.com/BinBashBanana/deploy-buttons/master/buttons/remade/replit.svg)](https://replit.com/github/binary-person/rammerhead)
[![Remix on Glitch](https://raw.githubusercontent.com/BinBashBanana/deploy-buttons/master/buttons/remade/glitch.svg)](https://glitch.com/edit/#!/import/github/binary-person/rammerhead)
[![Deploy to Azure](https://raw.githubusercontent.com/BinBashBanana/deploy-buttons/master/buttons/remade/azure.svg)](https://deploy.azure.com/?repository=https://github.com/binary-person/rammerhead)
[![Deploy to IBM Cloud](https://raw.githubusercontent.com/BinBashBanana/deploy-buttons/master/buttons/remade/ibmcloud.svg)](https://cloud.ibm.com/devops/setup/deploy?repository=https://github.com/binary-person/rammerhead)
[![Deploy to Amplify Console](https://raw.githubusercontent.com/BinBashBanana/deploy-buttons/master/buttons/remade/amplifyconsole.svg)](https://console.aws.amazon.com/amplify/home#/deploy?repo=https://github.com/binary-person/rammerhead)
[![Run on Google Cloud](https://raw.githubusercontent.com/BinBashBanana/deploy-buttons/master/buttons/remade/googlecloud.svg)](https://deploy.cloud.run/?git_repo=https://github.com/binary-person/rammerhead)


## Discord server

For any user-help non-issue related questions, please ask them here: [Rammerhead Support Server](https://discord.gg/VNT4E7gN5Y).
