#!/bin/bash

failed=0

for d in test-projects/*/ ; do
  echo ==== TEST ${d%/}
  cd $d
  npx yarn-comb --fix
  cd ../..
  ./test-lockfile-snapshot.sh $d || failed=1
done

exit $failed