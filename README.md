# check-peer-deps

[![Greenkeeper badge](https://badges.greenkeeper.io/Arcanemagus/check-peer-deps.svg)](https://greenkeeper.io/)
Verifies that the `peerDependency` requirements of all top level dependencies
are satisfied.

## Installation

You can install this on your system with:

```sh
npm i -g check-peer-deps
```

Please note that this utility requires `npm` to be available.

## Usage

Simply change into the directory of the project you wish to check the
`peerDependencies` of and run the program.

```sh
> cd foobar
> check-peer-deps
```

If the minimum versions of all your top level `peerDependencies` are satisfied
then there will be no output, otherwise you will see something similar to this:

```
  > check-peer-deps
  A dependency satisfying eslint-config-airbnb-base's peerDependency of 'eslint@^4.9.0' was not found!
  Current: eslint@^4.6.0
  Package dependencies can satisfy the peerDependency? Yes
```

This tells you that `eslint-config-airbnb-base` is requiring `eslint@^4.9.0` as
a `peerDependency`, but the project currently only specifies `eslint@^4.6.0`,
allowing a potential issue to arise if `eslint@4.6.0` was installed and not
updated before installing. The output also tells you that although the
_minimum_ allowed version is too low, the _maximum_ allowed version does
satisfy the `peerDependencies` requirement.
