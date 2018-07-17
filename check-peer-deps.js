const { exec: execCP } = require('child_process');
const { promisify } = require('util');
const { readFile: readFileFS } = require('fs');
const semver = require('semver');
const commandLineArgs = require('command-line-args');
const commandLineUsage = require('command-line-usage');

const exec = promisify(execCP);
const readFile = promisify(readFileFS);

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
    description: "Don't include development packages when checking whether a "
      + 'peerDependency has been satisfied',
    defaultValue: false,
  },
  {
    name: 'include-resolutions',
    description: 'Check for resolutions section of package.json when checking whether a peerDependency has been satisfied',
    defaultValue: false,
  },
  {
    name: 'max-retries',
    description: 'Specify how many retries are allowed for [underline]{npm} commands',
    type: Number,
    typeLabel: '[underline]{retries}',
    defaultValue: 2,
  },
  {
    name: 'directory',
    description: 'The directory to check peerDependencies within. Defaults '
      + 'to the current directory.',
    type: String,
    typeLabel: '[underline]{directory}',
    defaultValue: process.cwd(),
  },
];

const usageSections = [
  {
    header: 'check-peer-deps',
    content: 'Verifies that the peerDependency requirements of all top level '
      + 'dependencies are satisfied.',
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
const resolutions = new Map();

const log = (value) => {
  if (options.debug) {
    console.log(value);
  }
};

const addDeps = (dependencies) => {
  if (!dependencies) {
    return;
  }
  Object.entries(dependencies).forEach((entry) => {
    const [name, range] = entry;
    deps.set(name, range);
  });
};

const addResolutions = (res) => {
  if (!res) {
    return;
  }
  Object.entries(res).forEach((entry) => {
    const [name, range] = entry;
    resolutions.set(name, range);
  });
};

const readPackageConfig = async (path) => {
  let packageConfig = {};
  try {
    const contents = await readFile(path, { encoding: 'utf8' });
    packageConfig = JSON.parse(contents);
  } catch (e) {
    console.error(e.message);
  }
  return packageConfig;
};

const npmView = async (name, keys) => {
  const opts = ['view', '--json', name].concat(keys);
  const command = ['npm'].concat(opts).join(' ');
  log(`Running '${command}'`);
  let remainingTries = options['max-retries'];
  let output;
  do {
    try {
      // eslint-disable-next-line no-await-in-loop
      ({ stdout: output } = await exec(command));
    } catch (e) {
      log(`'${command}' failed with error ${e}, retrying...`);
      // Do nothing when it fails...
    }
    remainingTries -= 1;
  } while (remainingTries > 0 && !output);
  if (!output) {
    console.error(`To many retries of '${command}' without success, exiting!`);
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
  // Hacktown, USA.
  const packagePath = `${options.directory}/node_modules/${name}/package.json`;
  const packageInfo = await readPackageConfig(packagePath);
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
const checkPeerDependencies = (peerDependencies, name) => {
  peerDependencies.forEach((peerDepRange, peerDepName) => {
    log(`Checking ${name}'s peerDependency of '${peerDepName}@${peerDepRange}'`);
    let found = false;
    if (deps.has(peerDepName)) {
      // Verify that the minimum allowed version still satisfies the peerDep
      const minAllowedVer = npmVers.get(peerDepName).minimum;
      if (semver.satisfies(minAllowedVer, peerDepRange)) {
        found = true;
      }
    }

    if (resolutions.has(`${name}/${peerDepName}`)) {
      const minAllowedVer = resolutions.get(`${name}/${peerDepName}`);
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
  });
};

const checkAllPeerDeps = () => {
  peerDeps.forEach(checkPeerDependencies);
};

const findDependencies = async () => {
  const packageConfig = await readPackageConfig(`${options.directory}/package.json`);

  // Get the dependencies to process
  addDeps(packageConfig.dependencies);

  if (options['include-resolutions'] && packageConfig.resolutions) {
    addResolutions(packageConfig.resolutions);
  }

  if (!options['no-include-dev'] && packageConfig.devDependencies) {
    addDeps(packageConfig.devDependencies);
  }
};

// Main function
async function checkPeerDeps() {
  let shouldExit = false;
  options = commandLineArgs(optionDefinitions);

  if (options.help) {
    console.log(commandLineUsage(usageSections));
    shouldExit = true;
  }

  if (!shouldExit) {
    await findDependencies();

    if (deps.size < 1) {
      console.error('No dependencies in the current package!');
      shouldExit = true;
    }
  }

  if (!shouldExit) {
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
    checkAllPeerDeps();
    log('Done.');
  }
}

module.exports = checkPeerDeps;
