FROM node:13-buster-slim
COPY package.json /app/
COPY dist/src app/src
COPY node_modules app/node_modules
CMD node /app/src/relayserver/runServer.js --Workdir /app/data
