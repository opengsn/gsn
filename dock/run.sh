#!/bin/bash -e

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
ENVVARS="-e HOME=$HOME -e USER=$USER"

#echo "foldermaps=$FOLDER_MAPS"

if [ -t 1 ]; then TTY="-ti" ; else TTY="-i"; fi

# exited=
# function onexit() {
#     docker rm -f $DOCKNAME 
# }

# trap onexit EXIT

docker run $DOCK_OPT -u $UID:$GID  \
	--name $DOCKNAME \
	-p 8090:8090 -p 8545:8545 \
	$ENVVARS --rm $TTY -v $TMP_PASSWD:/etc/passwd \
	$FOLDERS $FOLDER_MAPS  \
	-w `pwd` $DOCKNAME $*

