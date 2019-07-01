module.exports = {
    "env": {
        "browser": true,
        "es6": true,
        "jest": true,
        "mocha": true,
        "node": true,
    },
    "globals" : {
        "artifacts": false,
        "assert": false,
        "contract": false,
        "web3": false,
    },
    "extends": "eslint:recommended",
    "parserOptions": {
        "ecmaVersion": 2017
    },
    "rules": {
        "no-console": "off",
    }
};
