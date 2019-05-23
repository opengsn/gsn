FROM phusion/baseimage
MAINTAINER "dror@tabookey.com"

RUN	apt-get update && \
	apt-get install -y git nodejs npm

RUN npm install -g n
RUN n stable

RUN npm install -g ganache-cli@6.4.3 truffle
RUN npm install truffle-hdwallet-provider
RUN npm install web3@1.0.0-beta.37
RUN npm install openzeppelin-solidity@2.1.2
RUN npm install @0x/contracts-utils@3.1.1


ADD ./RelayHttpServer /RelayHttpServer
ADD ./start-relay.sh /start-relay.sh
ADD ./fundrelay.js /scripts/fundrelay.js
ADD ./truffle.js /truffle.js
ADD ./contracts /contracts
ADD ./IRelayHub.js ./src/js/relayclient/IRelayHub.js
ADD ./migrations /migrations
ADD ./version /version
ADD ./start-relay-with-ganache.sh /start-relay-with-ganache.sh

CMD "/start-relay.sh"
