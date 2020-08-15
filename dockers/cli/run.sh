#!/bin/bash

#first are is gsn subcommand. the rest are paramters.
command=$1
shift

if [ -z "$command" -o ! -r /app/$command ]; then
echo "usage: gsn {command} [options]"
echo "   available commands:  `ls /app`"
exit 1
fi

node --no-deprecation /app/$command "$@"
