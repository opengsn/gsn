FROM phusion/baseimage
MAINTAINER "dror@tabookey.com"

RUN curl -sL https://deb.nodesource.com/setup_8.x | bash -
RUN	apt-get install software-properties-common && \
	add-apt-repository ppa:gophers/archive &&\
	add-apt-repository -y ppa:ethereum/ethereum && \
	apt-get update && \
	apt-get install -y git nodejs && \
	apt-get install -y golang-1.10-go && \
	apt-get install -y ethereum  && \
	rm -rf /var/lib/apt/lists/*

#for some reason, npm install -g chokes. so we install them "locally", in the root folder.
RUN npm install ganache-cli truffle

#need to select which version we install: default is (right now) 0.5.1
RUN curl -L -o /usr/local/bin/solc-4.24 https://github.com/ethereum/solidity/releases/download/v0.4.24/solc-static-linux && chmod a+rx /usr/local/bin/solc-4.24
RUN ln -s /usr/local/bin/solc-4.24 /usr/local/bin/solc
#RUN apt-get install -y solc

ENV PS1 "\e[31min-docker\e[0m \W \$ "
RUN echo "export PS1=\"$PS1\"" >> /etc/bash.bashrc
RUN echo "export PS1=\"$PS1\"" >> /root/.bashrc
ENV PATH /usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/node_modules/.bin:/usr/lib/go-1.10/bin


CMD "/bin/bash"
