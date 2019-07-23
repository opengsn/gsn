#!/bin/bash -e
#launch command inside docker image - so that we can run build commands in a consistent environment
#   on mac, linux.
# current working folder is exposed inside the docker image
# only the "build" and "node_modules" are separate (since host and docker might have different binary formats)
# for this reason, you must run "yarn" to install all packages again.
# actual build and node_modules are saved under build/dock-build and build/dock-node_modules
# by default, ports 8545, 8090 are forwarded into the docker image (so we can run a relay and ganache inside)
#
#environment variables:
#NO_PORT - disable port forwarding into the docker image.
#VERBOSE - show docker image re-creation (by default, it takes only 1-2 seconds, so we hide it, but after checking
#           out new version it might take longer)

DOCKNAME=relaydock

#list of folders that are mapped as-is into the docker image.
folders="`pwd` /Users /home"

# the "normal" host files.
# this is required since they contain binaries that are platform-dependent
#folder_maps="build node_modules"

#absolute prefix, where following folders are placed.
DOCKPREFIX=~/build/$DOCKANE-folders/
mkdir -p $DOCKPREFIX

#following folders are mapped under DOCKPREFIX, so they are kept on the host, but separate from
#silence the output of build if image already exists (and no VERBOSE=1)
# (since long build is usually the first-build)
if [ -z "$VERBOSE" ]; then docker images|grep -q $DOCKNAME && BQUIET=-q; fi

DOCK=`dirname $0`

test -n "$BQUIET" && printf "\r Rebuilding docker image (VERBOSE=1 to show).. \r"
docker build $BQUIET -t $DOCKNAME $DOCK
test -n "$BQUIET" && printf "\r                                               \r"

#for some reason, files in /tmp are inaccessible by dockerd
TMP_PASSWD=~/tmp/tmp.passwd
mkdir -p `dirname $TMP_PASSWD`
echo $USER:x:$UID:$UID:$USER:/:/bin/bash > $TMP_PASSWD

FOLDERS=""
for f in $folders ; do test -d $f && FOLDERS+=" -v $f:$f"; done
FOLDERS+=" -v `pwd`/build/dock-builD:`pwd`/build"
FOLDERS+=" -v `pwd`/build/dock-node_modules:`pwd`/node_modules"
mkdir -p build/dock-builD
mkdir -p build/dock-node_modules
ENVVARS="-e HOME=$HOME -e USER=$USER"

#echo "foldermaps=$FOLDER_MAPS"

if [ -t 1 ]; then TTY="-ti" ; else TTY="-i"; fi

# exited=
# function onexit() {
#     docker rm -f $DOCKNAME 
# }

# trap onexit EXIT

test -z "$NO_PORTS" && DOCK_PORTS="-p 8090:8090 -p 8545:8545"

docker run $DOCK_OPT -u $UID:$GID  \
	--name $DOCKNAME \
	$DOCK_PORTS \
	$ENVVARS --rm $TTY -v $TMP_PASSWD:/etc/passwd \
	$FOLDERS $FOLDER_MAPS  \
	-w `pwd` $DOCKNAME $*

