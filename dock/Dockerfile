FROM phusion/baseimage
MAINTAINER "dror@tabookey.com"

RUN curl -sL https://deb.nodesource.com/setup_8.x | bash -
RUN curl -sS https://dl.yarnpkg.com/debian/pubkey.gpg | apt-key add -
RUN echo "deb https://dl.yarnpkg.com/debian/ stable main" | tee /etc/apt/sources.list.d/yarn.list

RUN	add-apt-repository ppa:gophers/archive &&\
	add-apt-repository -y ppa:ethereum/ethereum && \
	apt-get update && \
	apt-get install -y software-properties-common && \
	apt-get install -y git nodejs && \
	apt-get install -y golang-1.10-go && \
	apt-get install -y ethereum  && \
	apt-get install -y netcat && \
	apt-get install --no-install-recommends yarn && \
	rm -rf /var/lib/apt/lists/*

#need to select which version we install: default is (right now) 0.5.10
RUN curl -L -o /usr/local/bin/solc-5.10 https://github.com/ethereum/solidity/releases/download/v0.5.10/solc-static-linux && chmod a+rx /usr/local/bin/solc-5.10
RUN ln -s /usr/local/bin/solc-5.10 /usr/local/bin/solc
#install ganache and truffle as global package
RUN npm -g install ganache-cli truffle --unsafe-perm

ENV PS1 "\e[31min-docker\e[0m \W \$ "
RUN echo "export PS1=\"$PS1\"" >> /etc/bash.bashrc
RUN echo "export PS1=\"$PS1\"" >> /root/.bashrc
ENV PATH /usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/node_modules/.bin:/usr/lib/go-1.10/bin


CMD "/bin/bash"
