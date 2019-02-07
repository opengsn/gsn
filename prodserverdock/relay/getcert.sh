#!/bin/bash -e
if ! grep -q CERTIFICATE data/$HOSTNAME.pem 2>/dev/null ; then

  echo a|certbot certonly --register-unsafely-without-email --standalone --preferred-challenges http -d $HOSTNAME
  cat /etc/letsencrypt/live/$HOSTNAME/fullchain.pem /etc/letsencrypt/live/$HOSTNAME/privkey.pem > data/$HOSTNAME.pem

fi

