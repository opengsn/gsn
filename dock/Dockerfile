FROM phusion/baseimage

RUN curl -sL https://deb.nodesource.com/setup_8.x | bash -
RUN add-apt-repository ppa:gophers/archive
RUN apt-get update
RUN apt-get install -y git nodejs 
RUN apt-get install -y golang-1.10-go

#for some reason, npm install -g chokes. so we install them "locally", in the root folder.
RUN npm install ganache-cli
RUN npm install truffle
RUN echo 'export PATH=$PATH:/node_modules/.bin' >> /etc/bash.bashrc

RUN apt-get install software-properties-common && \
	add-apt-repository -y ppa:ethereum/ethereum && \
	apt-get update && \
	apt-get install -y ethereum 

#need to select which version we install: default is (right now) 0.5.1
RUN curl -L -o /usr/local/bin/solc-4.24 https://github.com/ethereum/solidity/releases/download/v0.4.24/solc-static-linux && chmod a+rx /usr/local/bin/solc-4.24
RUN ln -s /usr/local/bin/solc-4.24 /usr/local/bin/solc
#RUN apt-get install -y solc

RUN echo 'export PS1="\e[31min-docker\e[0m \W \$ "' >> /etc/bash.bashrc
ENV PATH /usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/node_modules/.bin:/usr/lib/go-1.10/bin


CMD "/bin/bash"
