#!/bin/bash

CYAN='\033[1;36m'
WHITE='\033[1;37m' # overrides github grey default
NC='\033[0m' # No Color

failed=0

for d in test-projects/*/ ; do
  echo -e "\n${CYAN}TEST${WHITE}   ${d%/}${NC}\n"
  cd $d || exit
  npx yarn-comb --fix
  cd ../.. || exit
  ./test-lockfile-snapshot.sh $d || failed=1
done

exit $failed