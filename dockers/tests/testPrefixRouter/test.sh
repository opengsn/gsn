#!/bin/bash -e

VERSION=test ../../prefixrouter/dbuild.sh 2>&1 > /dev/null

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' 

if [ -n "$QUIET" ]; then
    #docker commands bypass tty, so they are always shown - unless we pass -t, and the "obey" the redirect to null
    TTY=-t
fi

function docker-compose {

	docker run $TTY  --rm --name test-dc -v /var/run/docker.sock:/var/run/docker.sock -v $PWD:$PWD -w $PWD docker/compose:1.26.0 "$@"
}

function expectUrl {
    url=$1
    search=$2
    title=$3
    test -z "$title" && title=$search

    data=`curl -s $url`
    if echo $data|grep -q "$search"; then
        printf "$title - ${GREEN}OK${NC}\n"
        let success=success+1
    else
        printf "$title - ${RED}failed${NC}\n"
	echo expectd: $search. data=$data
        let failed=failed+1
    fi
}
docker-compose up -d 2>&1 > /dev/null

expectUrl localhost:12345               "Not Found"     "no path"
expectUrl localhost:12345/whatever      "Not Found"     "wrong path"

expectUrl localhost:12345/proca/        "Name: proca"   "map to right instance"
expectUrl localhost:12345/proca/         "GET / "        "remove prefix and leave root"
expectUrl localhost:12345/proca/subtext "GET /subtext " "remove prefix"
expectUrl localhost:12345/procb/subtext "GET /subtext " "remove prefix 2nd instance"
expectUrl localhost:12345/procb/subtext "Name: procb"   "map to 2nd instance"

echo success=${success} failed=${failed}

test -n "SLEEP" && ( echo "Sleeping $SLEEP before exit. try http://localhost:12345/proca/"; sleep $SLEEP )

docker-compose down -t 0 2>&1 > /dev/null

test -z "$QUIET" && echo "Use QUIET=1 to silence docker up/down commands"
exit $failed
