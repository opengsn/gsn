### complete RelayServer instance

This docker is the main image to start a relay server.

This is a docker-compose configuration for loading relay instances and supporting modules.
It handles HTTP certificate, and routing to internal relay server(s).
Note that the actual "jsrelay" tag is hard-coded in this image: Simple "pull latest" might break
existing instances in case of API changes. 
Starting the latest "relaydc" WILL work, as it will add both old and new relay instances.

It is built with upgradeability in mind: as we deploy new contracts, a relay server should 
be able to support new version, while  keep supporting request on the old deployment.

## Configuration files:

- `.env` - should contain `HOST=my.host.name`
- `config/gsn-relay-config.json` - global configuration shared by all relay instances
   (sample configuration is in config-sample folder)
