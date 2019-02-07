#!/bin/bash -xe
source config/dns.txt

hostname=$HOST$DNS_SUFFIX
res=`curl --silent "$DNSREG_URL$hostname"`

if [[ "$res" =~ "$DNSREG_OK" ]] ; then
	echo registered dns for $hostname
else
	echo FAILED: unable to register $hostname: res=$res
	exit 1
fi
