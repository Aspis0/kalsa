/** @type {import('jest').Config} */
module.exports = {
  rootDir: __dirname,
  testEnvironment: "node",
  testMatch: ["**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          esModuleInterop: true,
          types: ["jest", "node"],
          target: "ES2022",
        },
      },
    ],
  },
};
