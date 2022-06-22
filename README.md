# yarn-comb
A tool to clean and understand your `yarn.lock` file [WIP]

![CI](https://github.com/wheeler/yarn-comb/actions/workflows/node.js.yml/badge.svg)


### quick-start
1. clone repo
2. run `yarn install` in repo folder to install dependencies
3. run `npm link` in repo folder
4. run `npx yarn-comb` in target project folder

### objective
This tool is an attempt to distill my personal understanding of how to apply manual modifications for a "de-duplication" of installed package versions. Manual modification of `yarn.lock` is not recommended in general - but this tool takes the approach of tactically deleting pieces of the file and letting `yarn install` regenerate what is missing. This is very similar to the accepted process of deleting the file entirely but limits the impact.

### why
I've done a decent amount of manual manipulation of `yarn.lock` files for `yarn` v1. Destroying and recreating the `yarn.lock` file entirely will help install leading versions and reduce the amount of duplications that occur for various inner dependencies when they have their dependencies bumped individually. Doing this all at once is dangerous in large projects because so many inner dependencies will change all at once. If it introduces a bug it's difficult to understand what the source was. Packages stated dependency semver requirements are never perfect and have difficulty predicting compatibility into the future. Additionally, sometimes packages are not incremented at true semver and may include minor or unexpected breaking changes.

### what does this script do?
- Read `yarn.lock` and look for package inclusions where the dependency requirements overlap (not all cases covered yet)
- Delete all overlapping inclusions from the `yarn.lock` file
- Run `yarn install` to have these dependencies re-installed
- when yarn installs overlapping dependencies fresh it will install only the latest version that satisfies

### future aspirations
- ~package is executable locally through `yarn link` + `npx yarn-comb`~
- publish as a npm package (so it can be generally npx'd)
- ~write >0 tests :]~
- write more tests for decent coverage
- rewrite my manual semver parsing to use published semver parsing packages
- handle more subtle deduplication such as minor downgrades
- walk up the package chain looking for dependency updates that will result in deduplication

### Other existing options
#### [yarn-deduplicate](https://www.npmjs.com/package/yarn-deduplicate)
This tool from Atlassian does similar work in a differing method - it *only* edits the `yarn.lock` file, manually combining requirement statements. It does not run `yarn install`. The result is that this will *never* install any new versions of the packages and therefore never increase any versions. It will only attempt to combine requirements given the currently installed set of versions. While safer in that sense, it results in fewer situations in which it is able to deduplicate. Note: in my experience you usually also have to run `yarn install` afterwards to clean up orphaned sub-dependencies.
#### delete yarn.lock, run `yarn install`
This is the umbrella solution - but as mentioned above, it will bump ALL package versions to the most recent satisfying version which exposes a large surface for unexpected breaking changes. 
