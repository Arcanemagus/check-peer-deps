const { exec: execCP } = require('child_process');
const { promisify } = require('util');
const path = require('path');

const exec = promisify(execCP);

const cpdBinPath = path.join(__dirname, '..', 'bin', 'check-peer-deps-cli.js');
const fixtures = path.join(__dirname, 'fixtures');

const EXEC_TIMEOUT = 20 * 1000; // 20 * 1000 ms = 20 seconds

const runCPD = async (args = [], options = {}) => {
  jest.setTimeout(EXEC_TIMEOUT);
  const command = [`"${process.execPath}"`, `"${cpdBinPath}"`]
    .concat(args).join(' ');
  return exec(command, options);
};

test('Finds nothing wrong with a good dependency tree', async () => {
  expect.assertions(2);
  const output = await runCPD([], { cwd: path.join(fixtures, 'goodDep') });
  expect(output.stdout).toBe('');
  expect(output.stderr).toBe('');
});

test('Finds the missing dependencies in a broken tree', async () => {
  expect.assertions(3);
  const output = await runCPD([], { cwd: path.join(fixtures, 'missingDep') });
  expect(output.stdout).toBe('');
  const issues = output.stderr.split('\n');
  expect(issues[0]).toBe("A dependency satisfying eslint-config-airbnb-base's "
    + "peerDependency of 'eslint@^4.9.0' was not found!");
  expect(issues[1]).toBe("A dependency satisfying eslint-config-airbnb-base's "
    + "peerDependency of 'eslint-plugin-import@^2.7.0' was not found!");
});

test('Finds nothing wrong with no peerDependencies in the tree', async () => {
  expect.assertions(2);
  const output = await runCPD([], { cwd: path.join(fixtures, 'noPeerDeps') });
  expect(output.stdout).toBe('');
  expect(output.stderr).toBe('');
});

test('Finds nothing wrong with a broken dependency tree backed up with resolutions', async () => {
  expect.assertions(2);
  const output = await runCPD(['--include-resolutions=true'], { cwd: path.join(fixtures, 'peerDepWithResolution') });
  expect(output.stdout).toBe('');
  expect(output.stderr).toBe('');
});
