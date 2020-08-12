#!/usr/bin/env node

const fs = require('fs');
const readline = require('readline');
const _groupBy = require('lodash/groupBy');
const _countBy = require('lodash/countBy');

const rl = readline.createInterface({
  input: fs.createReadStream('yarn.lock'),
  crlfDelay: Infinity,
});

const requireLines = [];

rl.on('line', line => {
  // only keep lines that are requirement definitions (not comment, not indented)
  if (line !== '' && !line.startsWith(' ') && !line.startsWith('#')) {
    requireLines.push(line.replace(/:$/, ''));
  }
});

const getPackageName = line => {
  line = line.replace(/^"/, '');
  if (line.startsWith('@')) {
    line = `@${line.split('@')[1]}`;
  } else {
    line = line.split('@')[0];
  }
  // line = line.substring(0, 20);
  return line;
};

// object-filter for only ones with multiple lines in the value
const multipleVersionPackages = groups => {
  const packageNames = Object.keys(groups);
  const multipleVersionPackageNames = packageNames.filter(k => groups[k].length > 1);

  const groupMultiples = {};
  multipleVersionPackageNames.forEach(k => {
    // filter the pkg name out of the lines as it is redundant
    groupMultiples[k] = groups[k].map(line => line.replace(new RegExp(`${k}@`, 'g'), ''));
  });
  return groupMultiples;
};

const detailCountWhere = (details, prop, val) =>
  _countBy(Object.values(details), deet => deet[prop])[val];

rl.on('close', () => {
  // take all the lines, group them by package name
  const groups = _groupBy(requireLines, getPackageName);

  const groupMultiples = multipleVersionPackages(groups);

  const details = {};
  Object.keys(groupMultiples).forEach(k => {
    details[k] = { lines: groupMultiples[k] };
    const majors = _groupBy(groupMultiples[k], line => {
      // this is still not exactly right as it will group 0.x with x.0
      return line.replace(/^[~^]/, '').replace(/^0\./, '0dot').split('.')[0];
    });
    if (Object.values(majors).some(val => val.length > 1)) {
      details[k].majorOverlaps = true;
    }
  });

  // console.log(details);

  console.log('yarn.lock report --------------------------');
  console.log('Total packages (including copies):', requireLines.length);
  console.log('  packages with multiple versions:', Object.keys(groupMultiples).length);
  console.log(
    '         duplicate major versions:',
    detailCountWhere(details, 'majorOverlaps', true),
  );
});
