module.exports = [
  {
    header: 'Check peer deps',
    content: 'Checks peer dependencies'
  }, {
    header: 'Options',
    optionList: [
      {
        name: 'help',
        description: 'Show this help',
        alias: 'h',
        type: Boolean
      }, {
        name: 'debug',
        description: 'Show debug information',
        alias: 'd',
        type: Boolean
      }, {
        name: '-no-include-dev',
        description: 'Avoid including dev dependencies in the check',
      }, {
        name: 'max-retries',
        description: 'Specify how many retries are allowed',
        type: Number,
        typeLabel: '[underline]{retries}',
        defaultOption: 2
      }
    ]
  }
];
