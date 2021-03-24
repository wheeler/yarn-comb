# yarn-comb
A tool to clean and understand your yarn.lock [WIP]

### objective
This tool is an attemept to distill my manual understanding of how to apply manual modifications for a "de-duplication" of installed package versions. Manual modification of `yarn.lock` is not recommended in general - but this tool takes the approach of tactically deleting pieces of the file and letting `yarn install` regenerate what is missing. This is very similar to the accepted process of deleting the file entirely but limits the impact.

### why
I've done a decent amount of manual manipulation of `yarn.lock` files for `yarn` v1. Destroying and recreating the `yarn.lock` file entirely will help install leading versions and reduce the amount of duplications that occur for various inner dependenceies when they have their dependencies bumped individually. Doing this all at once is dangerous in large projects because so many inner dependencies will change all at once. If it introduces a bug it's difficult to understand what the source was. Packages stated dependency semver requirements are never perfect and have difficulty predicting compatibility into the future. Additionally sometimes packages are not incremented at true semver and may include minor or unexpected breaking changes.

### what does this script do?
- Read `yarn.lock` and look for package inclusions where the dependency requirements overlap (not all cases covered yet)
- Delete all overlapping inclusions from the `yarn.lock` file
- Run `yarn install` to have these dependencies re-installed
- when yarn installs overlapping dependencies fresh it will install only the latest version that satisfies


### Other existing options
#### [yarn-deduplicate](https://www.npmjs.com/package/yarn-deduplicate)
This tool from Atlassian does similar work in a differing method - it *only* edits the `yarn.lock` file, manually combining requirement statements. It does not run `yarn install`. The result is that this will *never* install any new versions of the packages and therefore never increase any versions. It will only attempt to combine requirements given the currently installed set of versions. While safer in that sense, it results in fewer situations in which it is able to deduplicate. Note: in my experience you ususally also have to run `yarn install` afterwards to clean up orphaned sub-dependencies.
#### delete yarn.lock, run `yarn install`
This is the umbrella solution - but as mentioned above, it will bump ALL package versions to the most recent satisfying version which exposes a large surface for unexpected breaking changes. 
