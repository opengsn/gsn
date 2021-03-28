# GSN command-line tools

[GSN, the Ethereum Gas Station Network](https://opengsn.org/) abstracts away gas to minimize onboarding & UX friction for dapps. 

This module contains command-line tools made to help developers integrate GSN, test their integrations locally, or bring up relay servers on public Ethereum networks.

[Complete documentation is available here.](https://docs.opengsn.org/javascript-client/gsn-helpers.html)

Installation:

`npm install -g @opengsn/cli`

Usage:

`gsn start` - deploys GSN contracts and starts a single relay server on local network.

`gsn deploy` - deploys the singleton RelayHub instance, as well as other required GSN contracts

`gsn relayer-register` - fund and register the relay server; you need to run it after you start your own relayer on a public network

