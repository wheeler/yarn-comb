#!/usr/bin/env node

const fs = require('fs');
const semver = require('semver');
let intersect;
try {
  intersect = require('semver-range-intersect').intersect;
} catch {
  console.log('no access to semver-range-intersect')
}
const readline = require('readline');
const _groupBy = require('lodash/groupBy');
const _countBy = require('lodash/countBy');
const { spawn } = require('child_process');

let prompt;

///////////////////////////
// child_process helpers //
///////////////////////////

const spawnError = error => {
  console.log(`spawn error: ${error.message}`);
};

///////////////////////
// yarn.lock helpers //
///////////////////////

/**
 * Extract the package name from a yarn.lock dependency line
 *
 * @example
 *
 *     getPackageName('"@babel/helper-split-export-declaration@^7.10.1", "@babel/helper-split-export-declaration@^7.10.4"')
 *     // ==> returns '@babel/helper-split-export-declaration'
 *
 *
 * @param {string} - yarn.lock dependency line
 * @return {string} package name
 */
const getPackageName = line => {
  line = line.replace(/^"/, '');
  if (line.startsWith('@')) {
    line = `@${line.split('@')[1]}`;
  } else {
    line = line.split('@')[0];
  }
  return line;
};

// filter the pkg name out of the dependency definition as it is redundant
const removePackageNameFromDependency = (dependency, packageName) =>
  dependency.replace(new RegExp(`("|${packageName}@)`, 'g'), '');

const parseDependency = line => {
  const cleanLine = line.replace(/:$/, '');
  const package = getPackageName(cleanLine);
  const dependency = removePackageNameFromDependency(cleanLine, package);
  const strictness = getStrictness(dependency);
  return { package, dependency, strictness };
};

const parseVersion = line => {
  const version = line.replace(/(  version |")/g, '');
  return semver.parse(version);
};

const unknownStrictnesses = /[|<*\-x]/;

const getStrictness = dependency => {
  if (dependency.match(/^\d+\.\d+\.\d+/)) return 'Exact';
  if (dependency.match(/^\d+\.\d+/)) return 'Approximate';
  if (dependency.match(unknownStrictnesses)) return 'unknown';
  if (dependency.match(/^\^0\.0\./)) return 'Exact';
  if (dependency.match(/^~0\./)) return 'Exact';
  if (dependency.match(/^\^0\./)) return 'Approximate';
  if (dependency.includes('>=')) return 'Compatible';
  if (dependency.includes('^')) return 'Compatible';
  else if (dependency.includes('~')) return 'Approximate';
  return 'Exact?';
};

const rangeFromDependencyString = dependency => intersect(...dependency.split(', '));
const invalidRangesFromDependencyString = dependency => dependency.split(', ').filter(r => !semver.validRange(r))

////////////////////
// Read yarn.lock //
////////////////////

const packages = [];
let lineNumber = 1;
let previousPackageStartLine = 1;

const recordPreviousPackageLines = () => {
  if (!packages.length) return;
  const previousPackage = packages[packages.length - 1];
  previousPackage.lines = [previousPackageStartLine, lineNumber - 1];
  previousPackageStartLine = lineNumber;
};

const lockRead = readline.createInterface({
  input: fs.createReadStream('yarn.lock'),
  crlfDelay: Infinity,
});

lockRead.on('line', line => {
  // Add a record for lines that are requirement definitions (not comment, not indented)
  if (line !== '' && !line.startsWith(' ') && !line.startsWith('#')) {
    recordPreviousPackageLines();
    packages.push(parseDependency(line));
  }
  // attach the next line ("  version ...") to the previous dependency line
  if (line.startsWith('  version ')) {
    const installedSemver = parseVersion(line)
    packages[packages.length - 1] = {...packages[packages.length - 1], ...installedSemver}
  }

  lineNumber += 1;
});

// TODO: handle non-re-run dedupes like 10.5.2 + ~10.5.0

lockRead.on('close', () => {
  let groupPackages = _groupBy(packages, 'package');
  groupPackages = Object.values(groupPackages).map(gp => {
    const package = gp[0].package;
    const versions = gp.sort((a, b) => semver.compare(a.version, b.version));

    let multiple;
    let dupMajor = [];
    let dupMinor = [];
    if (versions.length > 1) {
      multiple = true;
      const dupMajorCounts = _countBy(versions.map(v => v.major));
      Object.keys(dupMajorCounts).forEach(k => {
        if (dupMajorCounts[k] > 1) dupMajor.push(k);
      });
      const dupMinorCounts = _countBy(versions.map(v => `${v.major}.${v.minor}`));
      Object.keys(dupMinorCounts).forEach(k => {
        if (dupMinorCounts[k] > 1) dupMinor.push(k);
      });
    } else multiple = false;

    let fixable = false;
    const recommendations = [];

    dupMajor.forEach(dm => {
      const filteredVersions = versions.filter(v => v.major === parseInt(dm));
      const strictnesses = _countBy(filteredVersions.map(v => v.strictness));

      if (strictnesses.Exact === filteredVersions.length) {
        return;
      }
      if (strictnesses.Compatible === filteredVersions.length) {
        fixable = true;
        recommendations.push(`Version ${dm} can be completely deduped!`);
        return;
      }
      if (strictnesses.Compatible > 1) {
        fixable = true;
        recommendations.push(`Some copies of version ${dm} can be deduped!`);
        return;
      }
      const compatibleVersion = filteredVersions.find(v => v.strictness === 'Compatible')
      const exactVersion = filteredVersions.filter(v => v.strictness === 'Exact')
      if (compatibleVersion && exactVersion.some(ev => ev.minor < compatibleVersion.minor)) {
        // recommendations.push(An exact version of ${dm} is lower than another - cannot dedupe without downgrading`);
        return;
      }
      // todo: report on minor dedupes
      recommendations.push(`Not sure what to do about version ${dm}, yo`);
    });

    return {
      package,
      versions,
      multiple,
      dupMajor: dupMajor.length != 0,
      dupMinor: dupMinor.length != 0,
      fixable,
      recommendations,
    };
  });

  // groupPackages.filter(gp => gp.package === 'apollo-server-env').map(gp => {
  //   const [v0, v1] = gp.versions.map(v => v.dependency);
  //   console.log({
  //     // v0,v1,
  //     // range0: semver.validRange(v0),
  //     // range0: new semver.Range(v0),
  //     // validRange1: semver.validRange(v1),
  //     // mergeRange1: v1.split(', '),
  //     // spaceRange1: semver.validRange(v1.replaceAll(',',' ')),
  //     // range1: new semver.Range(semver.validRange(v1.replaceAll(',','|| '))),
  //     intersect0: rangeFromDependencyString(v0),
  //     intersect1: rangeFromDependencyString(v1),
  //     bothIntersect: semver.intersects(intersect(...v0.split(', ')),intersect(...v1.split(', ')))
  //   })
  // })

  const newRecommendations = {exotic: [], resolved: [], downgrade: [], bumpable: [], unknown: []};
  if (intersect) {
    groupPackages.forEach(gp => {
      if (!gp.multiple) return;

      // console.log(gp.versions)
      gp.versions.forEach(({version, dependency}, index) => {
        const range = rangeFromDependencyString(dependency);
        if (!semver.satisfies(version, range)) {
          const invalidVersions = invalidRangesFromDependencyString(dependency);
          if (invalidVersions.length) {
            newRecommendations.exotic.push(`${gp.package} installed version ${version} is exotic!`)
            return;
          } else {
            newRecommendations.resolved.push(`${gp.package} installed version ${version} does not match dependency ${dependency}.`)
            return;
          }
        }

        if (index < gp.versions.length - 1) {
          const {version: nextVersion, dependency: nextDependency} = gp.versions[index + 1];
          const nextRange = rangeFromDependencyString(nextDependency);

          const overlap = semver.intersects(range, nextRange);
          if (overlap) {
            const aFitsB = semver.satisfies(version, nextRange)
            const bFitsA = semver.satisfies(nextVersion, range)

            if (bFitsA) {
              gp.recommendations.push(`semver overlap recommendation: ${gp.package} ${dependency} and ${nextDependency} look combinable`)
              gp.fixable = true;
              // tmp hack - flag these versions "compatible" so the line deleter deletes them
              gp.versions[index].strictness = 'Compatible'
              gp.versions[index+1].strictness = 'Compatible'
            } else if(aFitsB) {
              newRecommendations.downgrade.push(`${gp.package} dependency ${dependency} (${version}) and dependency ${nextDependency} (${nextVersion}) might be combined with downgrade.`)
            } else {
              newRecommendations.unknown.push(`${gp.package} dependency ${dependency} (${version}) and dependency ${nextDependency} (${nextVersion}) unknown.`)
              // newRecommendations.unknown.push({pkg:gp.package, version,dependency,nextVersion,nextDependency,aFitsB,bFitsA})
            }
            // else {
            //   newRecommendations.overlap.push(`${gp.package} dependency ${dependency} overlaps dependency ${nextDependency}.`)
            // }
          }
          // console.log('compare', dependency, 'with', gp.versions[index+1].dependency, semver.intersects(range, rangeFromDependencyString(gp.versions[index+1].dependency)))
        }
      });
    });
  }

  // old recs
  // console.dir(
  //   groupPackages.filter(gp => gp.recommendations.length > 0),
  //   // groupPackages.filter(gp => gp.fixable),
  //   { depth: null },
  // );
  // new recs
  console.dir(newRecommendations, {depth: null});

  console.log('yarn.lock report --------------------------');
  console.log('Total packages (including copies):', packages.length);
  console.log('  packages with multiple versions:', groupPackages.filter(gp => gp.multiple).length);
  console.log('         duplicate major versions:', groupPackages.filter(gp => gp.dupMajor).length);

  const fixable = groupPackages.filter(gp => gp.fixable);
  if (fixable.length === 0) {
    console.log('did not see any problems that can be autofixed');
  } else {
    console.log('recommendations:');
    fixable.forEach(gp => {
      console.log(gp.package, gp.recommendations);
    });

    prompt = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    prompt.question('Attempt autofix [Y/n]? ', answer => {
      if (!answer || answer.match(/^y(es)?/i)) {
        console.log('=====> Deleting fixable package lines from yarn.lock');

        const deleteRanges = [];
        fixable.forEach(gp => {
          gp.versions.forEach(v => {
            if (v.strictness === 'Compatible') deleteRanges.push(v.lines);
          });
        });
        const sedRanges = deleteRanges.map(([start, end]) => `-e ${start},${end}d`);
        const sed = spawn('sed', ['-i.old', ...sedRanges, 'yarn.lock'], { stdio: 'inherit' });

        sed.on('error', spawnError);

        sed.on('close', code => {
          if (code === 0) {
            console.log('*Success*');
            console.log('=====> Restore package(s) by calling yarn install');
            const yarn = spawn('yarn', ['-s'], { stdio: 'inherit' });

            yarn.on('error', spawnError);

            yarn.on('close', code => {
              if (code === 0) {
                console.log('<===== yarn successful, removing temporary file');
                spawn('rm', ['yarn.lock.old'], { detatch: true, stdio: 'inherit' });
              } else {
                console.log(
                  `<===== yarn was not successful (code ${code}), restoring old yarn.lock`,
                );
                spawn('mv', ['yarn.lock.old', 'yarn.lock'], { detatch: true, stdio: 'inherit' });
              }
              prompt.close();
            });
          } else {
            console.log(`<===== sed process exited with code ${code}`);
            prompt.close();
          }
        });
      } else {
        console.log('NO');
        prompt.close();
      }
    });

    prompt.on('close', () => {
      process.exit(0);
    });
  }
});
