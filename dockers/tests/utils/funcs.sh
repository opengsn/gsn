#!/bin/bash -x
#source this file for utility functions

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
NC='\033[0m' 

#green OK, red FAILED...
OK="${GREEN}OK${NC}"
FAILED="${RED}FAILED${NC}"

#first, clean any "preogress" message.
# then print line, cleaning colors before/after
function print {

    printf "$cleanprogress"
    cleanprogress=""
    printf "${NC}$*${NC}\n"
}

#print "progress" message - without newline.
# next print/progress will clear it out, and dump over it.
function progress {
	#just in case progress is called twice in a sequence
    printf "$cleanprogress"
    printf "${NC}$*${NC}\r"
 	#cleanprogress is a whitespace string long enough to hige the above progress text.."
    cleanprogress="\r`echo "$*"|sed -e 's/./ /g'`\r"
}

function reportfail {
    print "$FAILED: $*"
    let failed=failed+1
}

function reportok {
    print "$OK: $*"
    let success=success+1
}

function assertEq {
    value=$1
    expected=$2
    title=$3
    if [ "$value" == "$expected" ]; then
        #silently show nothing if OK and no title...
	   if [ -n "$title" ] ; then
            print "$OK - $title"
        fi
        let success=success+1
    else
        reportfail $title
        print "  expected: $expected"
        print "    actual: $value"
    fi
}

function assertNotEq {
    value=$1
    unexpected=$2
    title=$3
    if [ "$value" != "$unexpected" ]; then
        #silently show nothing if OK and no title...
       if [ -n "$title" ] ; then
            print "$OK - $title"
        fi
        let success=success+1
    else
        reportfail $title
        print "     actual: $value"
        print " unexpected: $unexpected"
    fi
}

function fatal {
    print "${RED}FATAL: $@"
    exit 1
}

function exitWithTestSummary {
    test -z "$success$failed" && fatal "no success/failed test results";
    print "${BLUE}Test Summary:"
    if [ -z "$failed" ]; then
        print "  ${GREEN}Successfully Passed${NC} all $success tests"
        exit 0
    else 
        print "  Passed: ${success} $FAILED: ${failed}"
        exit 1
    fi
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

#url - URL to ping
#expect - OK value to return
#STOPWAIT - failure string to return immediately with error, without timeout
#otherwise, wait for TIMEOUT (default=10 seconds)
function waitForUrl {
  url=$1
  expect=$2
  title=$4
  test -n "$title" || title=$url

  count=$TIMEOUT
  test -z "$count" && count=10

  progress "waiting for: $title"

  while [ $count != "0" ]; do 
    resp=`curl -s $url`
    if echo $resp |grep -q "$expect"; then
        reportok "$title"
        return
    fi
    if [ -n "$earlyfail" ]; then
        if echo $resp |grep -q "$STOPWAIT" ; then
            reportfail "url failed: $title\n${GRAY}  $resp"
            return 1
        fi
    fi
    sleep 1
    let count=count-1
  done
  reportfail "timeout: $title\n${GRAY}  $resp"
  return 1
}

case `uname` in

    Darwin)
        test -z "$MYIP" && export MYIP=`ifconfig|grep -v 127.0.0.1| awk '/inet / {print $2}'`
        ;;
    *)
	#TODO: validate implemetation!!
        test -z "$MYIP" && export MYIP=`hostname -I | awk '{print $1}'`
	;;
esac


