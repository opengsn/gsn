FROM phusion/baseimage
MAINTAINER "dror@tabookey.com"

RUN	apt-get update && \
	apt-get install -y git nodejs npm

RUN npm install -g n yarn
RUN n stable

RUN npm install -g ganache-cli@6.4.3 truffle
RUN echo '{}' > package.json
RUN npm install web3@1.0.0-beta.37
#not sure why this breaks installing other packages..
RUN rm -rf node_modules/websocket
RUN npm install openzeppelin-solidity@2.1.2 @0x/contracts-utils@3.1.1

ADD . .

CMD "/start-relay.sh"
