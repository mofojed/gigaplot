const path = require("path");

module.exports = {
  testEnvironment: "jsdom",
  roots: ["<rootDir>/packages", "<rootDir>/deephaven-plugin-gigaplot/src/js/src"],
  // @deephaven packages and some of their dependencies are published as ESM only
  transformIgnorePatterns: ["node_modules/(?!(@deephaven|nanoid)/)"],
  moduleNameMapper: {
    "\\.(css|scss)$": "identity-obj-proxy",
    "^gigaplot$": path.join(__dirname, "packages/gigaplot/src"),
  },
  setupFilesAfterEnv: [path.join(__dirname, "jest.setup.ts")],
};
