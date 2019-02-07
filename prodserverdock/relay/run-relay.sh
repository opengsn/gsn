#!/bin/bash  -e

public_port=${PORT=443}
local_port=8091

pwd=`dirname \`realpath $0\``
cd $pwd
pwd

#(created by "run" script)
test -x /tmp/auth.sh && /tmp/auth.sh

logfile=data/logfile.txt

#keep previous log as logfile.txt.1, previous to that in logfile.txt.2, etc.
last=.9
for d in .8 .7 .6 .5 .4 .3 .2 .1 "" ; do
test -r $logfile$d && mv $logfile$d $logfile$last
last=$d
done

echo update dnsname

source config/dns.txt 2>&1 >> $logfile
export HOSTNAME=$HOST$DNS_SUFFIX

./regdns.sh
url=https://$HOSTNAME:$public_port

./getcert.sh 2>&1 >> $logfile

echo Starting server on $url >> $logfile

socat openssl-listen:$public_port,fork,reuseaddr,cert=data/$HOSTNAME.pem,verify=0 tcp-connect:localhost:$local_port &
$pwd/bin/RelayHttpServer \
	-Url $url \
	-Port $local_port \
	-Workdir $pwd/data \
	`grep -v '^#' config/relay.txt` 2>> $logfile 

