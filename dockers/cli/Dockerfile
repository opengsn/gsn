FROM node:13-buster-slim
COPY run.sh /
COPY dist/* /app/

ENTRYPOINT [ "node", "--no-deprecation", "/app/gsn.js" ]
