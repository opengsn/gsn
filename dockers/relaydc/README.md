### complete RelayServer instance

This docker is the main image to start a relay server.

This is a docker-compose configuration for loading relay instances and supporting modules.

It is a docker-compose instance, which contains the docker-compose.yml configuration file in it.
It accept all docker-compose subcommands.

use the "rdc" wrapper script to launch,
e.g.
`rdc up -d`

It handles HTTP certificate, and routing to internal relay server(s).
By default, it contains a single jsrelay instance named "gsn1" pointing to the RelayHub.

To view its log do:
`rdc logs -d gsn1`

When an upgrade is requried (to the relayer server or to RelayHub), then all is needed is
to pull the latest version of this "opengsn/relaydc", and then
`rdc up -d`

It is built with upgradeability in mind: as we deploy new contracts, a relay server should 
be able to support new version, while  keep supporting requests on the old deployment.


## Configuration files:

- `.env` - should contain `HOST=my.host.name`
- `config/gsn-relay-config.json` - global configuration shared by all relay instances
   (sample configuration is in config-sample folder)
- all data is kept in "gsndata" folder - both server keys and temporary data. you can back up this folder
  to restore the server on another machine.
