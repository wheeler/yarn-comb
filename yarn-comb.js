#!/usr/bin/env node

const fs = require('fs');
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
 *     // returns '@babel/helper-split-export-declaration'
 *     getPackageName('"@babel/helper-split-export-declaration@^7.10.1", "@babel/helper-split-export-declaration@^7.10.4"')
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
  const version = line.replace(/(  version "|")/g, '');
  const splitVersion = version.replace(/^0\./, '0dot').split('.');
  const isZeroDot = splitVersion[0].includes('dot');
  if (isZeroDot) splitVersion[0] = splitVersion[0].replace(/dot/, '.');
  return { version, major: splitVersion[0], minor: `${splitVersion[0]}.${splitVersion[1]}` };
};

const unknownStrictnesses = /[|<*\-x]/;

const getStrictness = dependency => {
  if (dependency.match(/^\d+\.\d+\.\d+/)) return 'Exact';
  if (dependency.match(/^\d+\.\d+/)) return 'Approximate';
  if (dependency.match(unknownStrictnesses)) return 'unknown';
  if (dependency.includes('^')) return 'Compatible';
  else if (dependency.includes('~')) return 'Approximate';
  return 'Exact?';
};

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
    const package = packages[packages.length - 1];

    const { version, major, minor } = parseVersion(line);
    package.version = version;
    package.major = major;
    package.minor = minor;
  }

  lineNumber += 1;
});

lockRead.on('close', () => {
  let groupPackages = _groupBy(packages, 'package');
  groupPackages = Object.values(groupPackages).map(gp => {
    const package = gp[0].package;
    const versions = gp.map(({ dependency, version, major, minor, strictness, lines }) => {
      return {
        dependency: dependency,
        strictness: strictness,
        version,
        major,
        minor,
        lines,
      };
    });

    let multiple;
    let dupMajor = [];
    let dupMinor = [];
    if (versions.length > 1) {
      multiple = true;
      const dupMajorCounts = _countBy(versions.map(v => v.major));
      Object.keys(dupMajorCounts).forEach(k => {
        if (dupMajorCounts[k] > 1) dupMajor.push(k);
      });
      const dupMinorCounts = _countBy(versions.map(v => v.minor));
      Object.keys(dupMinorCounts).forEach(k => {
        if (dupMinorCounts[k] > 1) dupMinor.push(k);
      });
    } else multiple = false;

    let fixable = false;
    const recommendations = dupMajor.map(dm => {
      const filteredVersions = versions.filter(v => v.major === dm);
      const strictnesses = _countBy(filteredVersions.map(v => v.strictness));

      if (strictnesses.Compatible === filteredVersions.length) {
        fixable = true;
        return `Version ${dm} can be completely deduped!`;
      }
      if (strictnesses.Compatible > 1) {
        fixable = true;
        return `Some copies of version ${dm} can be deduped!`;
      }
      // todo: report on minor dedupes
      return `Not sure what to do about version ${dm}, yo`;
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

  // console.dir(
  //   // groupPackages.filter(gp => gp.dupMajor),
  //   groupPackages.filter(gp => gp.fixable),
  //   { depth: null },
  // );

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
            const yarn = spawn('yarn', [], { stdio: 'inherit' });

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
