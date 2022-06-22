#!/bin/bash

testpath=${1%/} # remove trailing slash if present

cmp --quiet $testpath/yarn.lock $testpath/yarn.lock.snap
cmpcode=$?


if [ $cmpcode == 0 ]
then
  echo "PASS  \`$testpath/yarn.lock\` file matched \`$testpath/yarn.lock.snap\`."
  exit 0
elif [ $cmpcode == 1 ] # cmp command will exit with code 1 if there is any difference
then
  echo "FAIL  \`$testpath/yarn.lock\` file had differences from \`$testpath/yarn.lock.snap\`."
  # comm command will output details
  comm -3 $testpath/yarn.lock $testpath/yarn.lock.snap
  exit 1
else # other exit codes means cmp failed (ex: 2 = No such file or directory)
  # re-run the command but not --quiet so we see the error output
  cmp $testpath/yarn.lock $testpath/yarn.lock.snap
  exit $cmpcode
fi