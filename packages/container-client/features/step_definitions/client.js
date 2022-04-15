// node
const assert = require('assert');
const os = require('os');
// vendors
const expect = require('expect');
const {JSONPath} = require('jsonpath-plus');
const { AfterAll, BeforeAll, Before, Given, When, Then, After } = require("@cucumber/cucumber");
// project
const { exec_launcher } = require("@podman-desktop-companion/executor");
const client = require("../../src");

// Helpers
async function ensureFixture() {}
async function performAssertions(scope) {
  // console.debug(result);
  const request = scope.request;
  const response_expected = scope.response_expected;
  const response_received = scope.response_received;
  // Tests values that are not undefined
  ["status", "statusText"].forEach((component) => {
    if (typeof response_expected[component] !== 'undefined') {
      const received = response_received[component];
      const expected = response_expected[component];
      assert.equal(received, expected, `Expected ${component} to be ${expected}, but it was ${received}`);
    }
  });
  if (typeof response_expected.headers !== 'undefined') {
    expect(request.headers).toEqual(response_expected.headers);
  }
  if (typeof response_expected.body !== 'undefined') {
    expect(request.body).toEqual(response_expected.body);
  }
  // Test JSON path matchers
  scope.response_matchers.forEach((matcher) => {
    const match = JSONPath({ path: matcher.path, json: scope.response_received });
    console.debug(match, matcher.expected);
  });
}

// Hooks
Before(function () {
  this.debug = false;
  this.environmentConfiguration = {
    machine: undefined,
    socketPath: {
      Windows_NT: undefined,
      Darwin: undefined,
      Linux: undefined
    },
  };
  this.communication = "api";
  this.request = {
    headers: {},
    method: "GET",
    url: "/"
  };
  this.response_expected = {
    status: undefined,
    statusText: undefined,
    headers: {},
    body: undefined,
    // JSON path matches
  };
  this.response_received = undefined;
  this.response_matchers = [];
});
After(async function() {
  await performAssertions(this);
})
BeforeAll(function() {
});
AfterAll(function() {
});

// Environment setup
Given('that the environment configuration is:', function (docString) {
  this.environmentConfiguration = JSON.parse(docString);
});
Given('that the environment is ready', async function () {
  const result = await exec_launcher("podman", ["machine", "list", "--noheading", "--format", "json"]);
  if (!result.success) {
    throw new Error("Unable to obtain list of machines");
  }
  let machine;
  try {
    machines = JSON.parse(result.stdout);
    machine = machines[0];
  } catch (error) {
    console.error("Machines list parsing error", error);
    throw new Error("Unable to parse machines list: ");
  }
  assert.ok(machine, `Machine "${this.environmentConfiguration.machine}" was not found - please ensure it is initialized (\`podman machine init\`)`);
  assert.ok(machine.Running, `Machine "${this.environmentConfiguration.machine}" is not running - please ensure it is running (\`podman machine start\`)`);
  this.machine = machine;
});

// Command
Given('that this command is successful:', async function (command) {
  const [program, ...args] = command.split(" ");
  const result = await exec_launcher(program, args);
  assert.ok(result.success, result.stderr);
  this.lastCommand = result;
});

// Debugging
Given('I debug', function() {
  this.debug = true;
  console.debug(">> DEBUG <<", JSON.stringify({ request: this.request, response: this.response_received }, null, 2));
});

// Fixtures seeding
Given(/^an? "(\w+)" exists/i, function (entity) {
  ensureFixture(entity);
});

When(/^i make an? "(GET|POST|PUT|DELETE|PATCH|HEAD)" request to "(.*)"/i, async function (method, url) {
  this.request.method = method;
  this.request.url = url;
  // Make request
  let driver;
  if (this.communication === "api") {
    driver = client.getApiDriver();
  }
  const response = await driver.request(this.request);
  this.response_received = {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    body: response.data
  };
});

Then("the response {string} should be {string}", async function (component, value) {
  if (component[0] === '$') {
    this.response_matchers.push({ path: component, expected: value });
  } else {
    this.response_expected[component] = value;
  }
});

Then("the response {string} should be:", async function (component, docString) {
  if (component[0] === '$') {
    this.response_matchers.push({ path: component, expected: JSON.parse(docString) });
  } else {
    this.response_expected[component] = JSON.parse(docString);
  }
});
