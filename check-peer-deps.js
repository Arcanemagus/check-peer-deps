const { exec } = require('sb-exec');
const semver = require('semver');

// Flags
// Enable debug output
const DEBUG = false;
// Include development packages when checking whether a peerDependency has been
// satisfied.
const INCLUDE_DEV = true;
// Use the local package.json files or check NPM to determine the peerDependencies
const USE_LOCAL_PEERDEPS = true;

// Internal vars
const deps = new Map();
const npmVers = new Map();
const peerDeps = new Map();

const log = (value) => {
  if (DEBUG) {
    console.log(value);
  }
};

const addDeps = (dependencies) => {
  Object.entries(dependencies).forEach((entry) => {
    const [name, range] = entry;
    deps.set(name, range);
  });
};

const gatherNpmVer = async (range, name) => {
  log(`Getting versions for ${name}@${range}...`);
  const opts = ['view', '--json', name, 'versions'];
  const versions = JSON.parse(await exec('npm', opts));
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
    if (deps.has(name)) {
      await gatherNpmVer(deps.get(name), name);
    }
  }));
};

// Get the peerDependencies
const getNpmPeerDep = async (range, name) => {
  log(`Getting peerDependencies for ${name}`);
  const opts = ['view', '--json', name, 'peerDependencies'];
  const npmPeerDeps = JSON.parse(await exec('npm', opts));
  if (!peerDeps.has(name)) {
    peerDeps.set(name, new Map());
  }
  const currDeps = peerDeps.get(name);
  Object.entries(npmPeerDeps).forEach((entry) => {
    const [depName, depRange] = entry;
    log(`${depName}@${depRange}`);
    currDeps.set(depName, depRange);
  });
};

const getLocalPeerDep = async (range, name) => {
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
  if (!peerDeps.has(name)) {
    peerDeps.set(name, new Map());
  }
  const currDeps = peerDeps.get(name);
  Object.entries(packageInfo.peerDependencies).forEach((entry) => {
    const [depName, depRange] = entry;
    log(`${depName}@${depRange}`);
    currDeps.set(depName, depRange);
  });
};

const getPeerDeps = async () => {
  const promises = [];
  if (USE_LOCAL_PEERDEPS) {
    log("Using local package.json's to determine peerDependencies.");
  } else {
    log('Using NPM to determine peerDependencies.');
  }
  deps.forEach((range, name) => {
    if (USE_LOCAL_PEERDEPS) {
      promises.push(getLocalPeerDep(range, name));
    } else {
      promises.push(getNpmPeerDep(range, name));
    }
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
      console.error(`A ${INCLUDE_DEV ? '[dev]D' : 'd'}ependency satisfying ${name}'s peerDependency of '${peerDepName}@${peerDepRange}' was not found!`);

      if (deps.has(peerDepName)) {
        console.log(`Current: ${peerDepName}@${deps.get(peerDepName)}`);
        const { versions } = npmVers.get(peerDepName);
        const maxUsabe = semver.maxSatisfying(versions, peerDepRange);
        console.log(`Required version is allowed? ${maxUsabe ? 'Yes' : 'No'}`);
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
  // eslint-disable-next-line import/no-dynamic-require
  const packageConfig = require(`${process.cwd()}/package.json`);
  if (!packageConfig.dependencies) {
    console.error('No dependencies in the current pacakge!');
  }

  // Get the dependencies to process
  addDeps(packageConfig.dependencies);

  if (INCLUDE_DEV && packageConfig.devDependencies) {
    addDeps(packageConfig.devDependencies);
  }

  log('Dependencies:');
  deps.forEach((range, name) => { log(`${name}: ${range}`); });

  log('Determining peerDependencies...');
  await getPeerDeps();
  log('Done.');

  // Get the NPM versions required to check the peerDependencies
  log('Determining version ranges from NPM...');
  await getNpmVersions();
  log('Done.');

  log('Checking versions...');
  await checkAllPeerDeps();
  log('Done.');
}

module.exports = checkPeerDeps;
