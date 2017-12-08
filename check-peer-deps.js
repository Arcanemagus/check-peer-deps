const { exec } = require('sb-exec');
const semver = require('semver');
const commandLineArgs = require('command-line-args');
const commandLineUsage = require('command-line-usage');

const optionDefinitions = [
  {
    name: 'help',
    description: 'Show this help',
    type: Boolean,
    alias: 'h',
  },
  {
    name: 'debug',
    description: 'Enable debug information',
    type: Boolean,
    alias: 'd',
    defaultValue: false,
  },
  {
    name: 'no-include-dev',
    description: "Don't include development packages when checking whether a " +
      'peerDependency has been satisfied',
    defaultValue: false,
  },
  {
    name: 'max-retries',
    description: 'Specify how many retries are allowed for [underline]{npm} commands',
    type: Number,
    typeLabel: '[underline]{retries}',
    defaultValue: 2,
  },
];

const usageSections = [
  {
    header: 'check-peer-deps',
    content: 'Verifies that the peerDependency requirements of all top level ' +
      'dependencies are satisfied.',
  },
  {
    header: 'Options',
    optionList: optionDefinitions,
  },
];

let options;

// Internal vars
const deps = new Map();
const npmVers = new Map();
const peerDeps = new Map();

const log = (value) => {
  if (options.debug) {
    console.log(value);
  }
};

const addDeps = (dependencies) => {
  Object.entries(dependencies).forEach((entry) => {
    const [name, range] = entry;
    deps.set(name, range);
  });
};

const npmView = async (name, keys) => {
  const opts = ['view', '--json', name].concat(keys);
  log(`Running 'npm ${opts.join(' ')}'`);
  let remainingTries = options['max-retries'];
  let output;
  do {
    try {
      // eslint-disable-next-line no-await-in-loop
      output = await exec('npm', opts);
    } catch (e) {
      log(`'npm ${opts.join(' ')}' failed, retrying...`);
      // Do nothing when it fails...
    }
    remainingTries -= 1;
  } while (remainingTries > 0 && !output);
  if (!output) {
    console.error(`To many retries of 'npm ${opts.join(' ')}' without success, exiting!`);
    process.exit(1);
  }
  return JSON.parse(output);
};

const gatherNpmVer = async (range, name) => {
  log(`Getting versions for ${name}@${range}...`);
  const versions = await npmView(name, 'versions');
  const ranges = {
    versions,
    minimum: semver.minSatisfying(versions, range),
    maximum: semver.maxSatisfying(versions, range),
  };
  log(`${name}@${range}: '${ranges.minimum}' to '${ranges.maximum}'`);
  npmVers.set(name, ranges);
};

const getNpmVersions = async () => {
  // Gather the unique package names
  const toCheck = new Set();
  peerDeps.forEach((peerDependencies) => {
    peerDependencies.forEach((range, name) => {
      toCheck.add(name);
    });
  });

  // Grab the versions from NPM
  return Promise.all(Array.from(toCheck.values()).map(async (name) => {
    if (deps.has(name) && !npmVers.has(name)) {
      await gatherNpmVer(deps.get(name), name);
    }
  }));
};

const addPeerDeps = (name, peerDependencies) => {
  if (!peerDeps.has(name)) {
    peerDeps.set(name, new Map());
  }
  const currDeps = peerDeps.get(name);
  Object.entries(peerDependencies).forEach((entry) => {
    const [depName, depRange] = entry;
    log(`${name} peerDependency: ${depName}@${depRange}`);
    currDeps.set(depName, depRange);
  });
};

// Get the peerDependencies
const getNpmPeerDep = async (range, name) => {
  log(`Getting NPM peerDependencies for ${name}`);
  const npmPeerDeps = await npmView(name, 'peerDependencies');
  addPeerDeps(name, npmPeerDeps);
};

const getPeerDep = async (range, name) => {
  log(`Getting peerDependencies for ${name}`);
  let packageInfo;
  try {
    // Hacktown, USA.
    // eslint-disable-next-line import/no-dynamic-require
    packageInfo = require(`${process.cwd()}/node_modules/${name}/package.json`);
  } catch (e) {
    return;
  }
  if (!packageInfo.peerDependencies) {
    return;
  }

  if (!npmVers.has(name)) {
    await gatherNpmVer(range, name);
  }
  if (semver.lt(packageInfo.version, npmVers.get(name).maximum)) {
    // The installed version isn't the highest allowed, check the latest from NPM
    log(`${name}: Installed version lower than allowed version. Using NPM to determine peerDependencies.`);
    await getNpmPeerDep(range, name);
  } else {
    log(`${name}: Using local package.json's to determine peerDependencies.`);
    addPeerDeps(name, packageInfo.peerDependencies);
  }
};

const getPeerDeps = async () => {
  const promises = [];
  deps.forEach((range, name) => {
    promises.push(getPeerDep(range, name));
  });
  return Promise.all(promises);
};

// peerDependencies checks
const checkPeerDependencies = async (peerDependencies, name) =>
  Promise.all(Array.from(peerDependencies.entries()).map(async (entry) => {
    const [peerDepName, peerDepRange] = entry;
    log(`Checking ${name}'s peerDependency of '${peerDepName}@${peerDepRange}'`);
    let found = false;
    if (deps.has(peerDepName)) {
      // Verify that the minimum allowed version still satisfies the peerDep
      const minAllowedVer = npmVers.get(peerDepName).minimum;
      if (semver.satisfies(minAllowedVer, peerDepRange)) {
        found = true;
      }
    }

    if (!found) {
      console.error(`A dependency satisfying ${name}'s peerDependency of '${peerDepName}@${peerDepRange}' was not found!`);

      if (deps.has(peerDepName)) {
        console.log(`Current: ${peerDepName}@${deps.get(peerDepName)}`);
        const { versions } = npmVers.get(peerDepName);
        const maxUsable = semver.maxSatisfying(versions, peerDepRange);
        console.log(`Package dependencies can satisfy the peerDependency? ${maxUsable ? 'Yes' : 'No'}`);
      }
    }
  }));

const checkAllPeerDeps = async () => {
  const promises = [];
  peerDeps.forEach((peerDependencies, name) => {
    promises.push(checkPeerDependencies(peerDependencies, name));
  });
  return Promise.all(promises);
};

// Main function
async function checkPeerDeps() {
  options = commandLineArgs(optionDefinitions);

  if (options.help) {
    console.log(commandLineUsage(usageSections));
    process.exit(0);
  }

  // eslint-disable-next-line import/no-dynamic-require
  const packageConfig = require(`${process.cwd()}/package.json`);
  if (!packageConfig.dependencies) {
    console.error('No dependencies in the current pacakge!');
  }

  // Get the dependencies to process
  addDeps(packageConfig.dependencies);

  if (!options['no-include-dev'] && packageConfig.devDependencies) {
    addDeps(packageConfig.devDependencies);
  }

  log('Dependencies:');
  deps.forEach((range, name) => { log(`${name}: ${range}`); });

  log('');

  log('Determining peerDependencies...');
  await getPeerDeps();
  log('Done.');

  log('');

  // Get the NPM versions required to check the peerDependencies
  log('Determining peerDependency version ranges from NPM...');
  await getNpmVersions();
  log('Done.');

  log('');

  log('Checking versions...');
  await checkAllPeerDeps();
  log('Done.');
}

module.exports = checkPeerDeps;
