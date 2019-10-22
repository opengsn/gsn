# Manual setup for a GSN relayer

The following steps were tested on amazon AWS Ubuntu instance.

Make sure to modify your network specific parameters: 

Your hostname (instead of `example.com`), and infura `NETWORK` and `INFURATOKEN`.


## Compile the server
Can be done on a local machine, and only copy the output RelayHttpServer to the target instance:

On Linux (requires preinstalled `truffle`, `go`, `geth`):
```
yarn 
make server
cp build/server/bin/RelayHttpServer .
```

Using Docker: On Mac - or Linux without the above pre-requisites (requires only `docker`):
```
./dock/run.sh yarn
./dock/run.sh make
./dock/run.sh cp build/server/bin/RelayHttpServer .
```

## Install nginx and certbot
```
sudo add-apt-repository universe
sudo add-apt-repository ppa:certbot/certbot
sudo apt-get update
sudo apt-get install nginx software-properties-common certbot python-certbot-nginx
```

## Create app folder
```
sudo mkdir -p /app/bin
sudo mkdir -p /app/data
sudo chown -R ubuntu:ubuntu /app
cp RelayHttpServer /app/bin
```

## Get certificate and cron it
```
sudo certbot certonly --nginx
sudo echo "/usr/bin/certbot renew --quiet" > /etc/cron.monthly/certbot
```

## Config nginx
```
cd /etc/nginx
sudo rm sites-enabled/default
```

### /etc/nginx/sites-available/relayer
```
log_format postdata escape=json '$remote_addr - $remote_user [$time_local] '
                        '"$request" $status $bytes_sent '
                        '"$http_referer" "$http_user_agent" "$request_body"';

server {
  listen 80;
  server_name example.com;
  
  location ~ /.well-known {
    root /var/www/html;
    allow all;
  }

  location / {
    return 301 https://$server_name$request_uri;
  } 
}

server {
  listen 443 ssl;
  server_name example.com;

  ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;

  location / {
    access_log /var/log/nginx/access.log postdata;

    proxy_pass http://localhost:8091;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_cache_bypass $http_upgrade;
  }
}
```

## Enable new site
```
cd sites-enabled
sudo ln -ns ../sites-available/relayer
sudo nginx -s reload
```

## Setup environment

### /app/env

```
URL=https://example.com
LOCAL_PORT=8091
WORKDIR=/app/data
NODE_URL=https://NETWORK.infura.io/v3/INFURATOKEN
RELAY_HUB=0xD216153c06E857cD7f72665E0aF1d7D82172F494
GAS_PRICE_PERCENT=70
```

## Configure service on systemd

### /etc/sytemd/system/relayer.service
```
[Unit]
Description=GSN relayer
StartLimitIntervalSec=300

[Service]
User=ubuntu
Group=ubuntu
Type=simple
WorkingDirectory=/app/
EnvironmentFile=/app/env
ExecStart=/app/bin/RelayHttpServer -Url ${URL} -Port ${LOCAL_PORT} -Workdir ${WORKDIR} -EthereumNodeUrl ${NODE_URL} -RelayHubAddress ${RELAY_HUB} -GasPricePercent ${GAS_PRICE_PERCENT}
StandardOutput=journal
StandardError=journal
Restart=on-failure
RestartSec=30
StartLimitBurst=5

[Install]
WantedBy=default.target
```

## Start service
```
sudo systemctl daemon-reload
sudo systemctl enable relayer
sudo systemctl start relayer
```

## Test it (from local workstation)
```
curl 'https://example.com/getaddr'
```

should return a json with `Ready:false`

## Fund it (from local workstation)
```
./scripts/fundrelay.js RELAY_HUB_ADDRESS 'https://example.com' 0 PROVIDER_URL
```

The above script will stake the relay (with 1 eth), and then fund it with 1 eth.
Note that staking the relay makes your account its OWNER. Collected fees from relaying 
transactions are going into your account.

Once funded, the above test should show `Ready:true`.
For troubleshooting, you can look on the relay server at the log:

```
journalctl -u relay
```
