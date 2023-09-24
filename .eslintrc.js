module.exports = {
  env: {
    browser: true,
    es6: true,
    jest: true,
    mocha: true,
    node: true
  },
  globals: {
    artifacts: false,
    assert: false,
    contract: false,
    web3: false
  },
  extends:
    [
      'standard-with-typescript'
    ],
  // This is needed to add configuration to rules with type information
  parser: '@typescript-eslint/parser',
  plugins: ["@typescript-eslint"],
  parserOptions: {
    // The 'tsconfig.packages.json' is needed to add not-compiled files to the project
    project: ['./tsconfig.json', './tsconfig.packages.json']
  },
  ignorePatterns: [
    '**/types/truffle-contracts',
    '**/types/ethers-contracts',
    'dist/'
  ],
  rules: {
    'no-console': 'off',
    '@typescript-eslint/no-var-requires': 'off',
    '@typescript-eslint/require-array-sort-compare': ['error',
      {
        ignoreStringArrays: true
      }
    ]
  },
  overrides: [
    {
      files: [
        '**/test/**/*.ts'
      ],
      rules: {
        'no-unused-expressions': 'off',
        // chai assertions trigger this rule
        '@typescript-eslint/no-unused-expressions': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off'
      }
    },
    {
      // otherwise it will raise an error in every JavaScript file
      files: ['*.ts'],
      rules: {
        '@typescript-eslint/ban-ts-comment': 'off',
        '@typescript-eslint/prefer-ts-expect-error': 'off',
        // allow using '${val}' with numbers, bool and null types
        '@typescript-eslint/restrict-template-expressions': [
          'error',
          {
            allowNumber: true,
            allowBoolean: true,
            allowNullish: true
          }
        ]
      }
    }
  ]
}
