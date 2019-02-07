FROM phusion/baseimage

RUN apt-get update && \
	apt-get install -y software-properties-common && \
	add-apt-repository universe && \
	add-apt-repository ppa:certbot/certbot && \
	apt-get update && \
	apt-get install -y socat && \
	apt-get install -y certbot && \
	apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

#enable ssh (for debug) - still, need USE_SSH=1 for start to expose it.
RUN	rm -f /etc/service/sshd/down && \
	/etc/my_init.d/00_regen_ssh_host_keys.sh

RUN	mkdir /etc/service/relayd && \
	ln -s /relay/run-relay.sh /etc/service/relayd/run

ADD 	relay relay
RUN 	rm relay/config/*

CMD ["/sbin/my_init"]


