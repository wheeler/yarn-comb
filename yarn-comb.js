#!/usr/bin/env node

const fs = require('fs');
const readline = require('readline');
const _groupBy = require('lodash/groupBy');
const _countBy = require('lodash/countBy');

const rl = readline.createInterface({
  input: fs.createReadStream('yarn.lock'),
  crlfDelay: Infinity,
});

const packages = [];

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

rl.on('line', line => {
  // Add a record for lines that are requirement definitions (not comment, not indented)
  if (line !== '' && !line.startsWith(' ') && !line.startsWith('#')) {
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
});

const unknownStrictnesses = /[|<*\-x]/;

const getStrictness = dependency => {
  if (dependency.match(/^\d+\.\d+\.\d+/)) return 'Exact';
  if (dependency.match(/^\d+\.\d+/)) return 'Approximate';
  if (dependency.match(unknownStrictnesses)) return 'unknown';
  if (dependency.includes('^')) return 'Compatible';
  else if (dependency.includes('~')) return 'Approximate';
  return 'Exact?';
};

rl.on('close', () => {
  let groupPackages = _groupBy(packages, 'package');
  groupPackages = Object.values(groupPackages).map(gp => {
    const package = gp[0].package;
    const versions = gp.map(({ dependency, version, major, minor, strictness }) => {
      return {
        dependency: dependency,
        strictness: strictness,
        version,
        major,
        minor,
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
      // console.log(package, dupMajor);
    } else multiple = false;

    const recommendations = dupMajor.map(dm => {
      return `dedupe version ${dm} yo`;
    });

    return {
      package,
      versions,
      multiple,
      dupMajor: dupMajor.length != 0,
      dupMinor: dupMinor.length != 0,
      recommendations,
    };
  });

  console.dir(
    groupPackages.filter(gp => gp.dupMajor),
    { depth: null },
  );

  console.log('yarn.lock report --------------------------');
  console.log('Total packages (including copies):', packages.length);
  console.log('  packages with multiple versions:', groupPackages.filter(gp => gp.multiple).length);
  console.log('         duplicate major versions:', groupPackages.filter(gp => gp.dupMajor).length);
});
