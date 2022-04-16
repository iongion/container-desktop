// node
const assert = require("assert");
// vendors
const expect = require("expect");
const { JSONPath } = require("jsonpath-plus");
const template = require("lodash.template");
const { AfterAll, BeforeAll, Before, Given, When, Then, After } = require("@cucumber/cucumber");
// project
const { exec_launcher } = require("@podman-desktop-companion/executor");
const client = require("../../src");

// Helpers
async function useMachine() {
  return true;
}
async function ensureFixture() {}
async function performAssertions(scope) {
  // console.debug(result);
  const request = scope.request;
  const response_expected = scope.response_expected;
  const response_received = scope.response_received;
  // Tests values that are not undefined
  ["status", "statusText"].forEach((component) => {
    if (typeof response_expected[component] !== "undefined") {
      const received = response_received[component];
      const expected = response_expected[component];
      assert.equal(received, expected, `Expected ${component} to be ${expected}, but it was ${received}`);
    }
  });
  if (typeof response_expected.headers !== "undefined") {
    expect(request.headers).toEqual(response_expected.headers);
  }
  if (typeof response_expected.body !== "undefined") {
    expect(request.body).toEqual(response_expected.body);
  }
  // Test JSON path matchers
  scope.response_matchers.forEach((matcher) => {
    const json = {
      response: scope.response_received
    };
    const matches = JSONPath({ path: matcher.path, json });
    expect(Array.isArray(matcher.expected) ? matches : matches[0]).toEqual(matcher.expected);
  });
}

// Hooks
Before(function () {
  // setLevel("debug");
  this.debug = false;
  this.environmentConfiguration = {
    machine: undefined,
    socketPath: {
      Windows_NT: undefined,
      Darwin: undefined,
      Linux: undefined
    }
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
    body: undefined
    // JSON path matches
  };
  this.response_received = undefined;
  this.response_matchers = [];
  this.store = {};
  this.getTemplateContext = function () {
    return {
      store: this.store,
      first: (path) => {
        const json = {
          response: this.response_received
        };
        const matches = JSONPath({ path, json });
        return matches[0] || "";
      }
    };
  };
});
After(async function () {
  await performAssertions(this);
});
BeforeAll(function () {});
AfterAll(function () {});

// Environment setup
Given("that the environment configuration is:", function (docString) {
  this.environmentConfiguration = JSON.parse(docString);
});
Given("that the environment is ready", async function () {
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
    throw new Error("Unable to parse machines list");
  }
  assert.ok(
    machine,
    `Machine "${this.environmentConfiguration.machine}" was not found - please ensure it is initialized (\`podman machine init\`)`
  );
  assert.ok(
    machine.Running,
    `Machine "${this.environmentConfiguration.machine}" is not running - please ensure it is running (\`podman machine start\`)`
  );
  this.machine = machine;
});

// Command
Given("that this command is successful:", async function (commandString) {
  const flag = await useMachine();
  const compileTemplate = template(commandString);
  const command = compileTemplate(this.getTemplateContext());
  const [program, ...args] = command.split(" ");
  const result = await exec_launcher(program, flag ? ["machine", "ssh", "podman", ...args] : args, { timeout: 15000 });
  assert.ok(result.success, result.stderr);
  assert.ok(result.code === 0, result.stderr);
  this.lastCommand = result;
});
Given("that I store in {string} the result of command:", async function (storeKey, commandString) {
  const flag = await useMachine();
  const compileTemplate = template(commandString);
  const command = compileTemplate(this.getTemplateContext());
  const [program, ...args] = command.split(" ");
  const result = await exec_launcher(program, flag ? ["machine", "ssh", "podman", ...args] : args, { timeout: 15000 });
  assert.ok(result.success, result.stderr);
  assert.ok(result.code === 0, result.stderr);
  this.store[storeKey] = JSON.parse(result.stdout);
});

// Debugging
Given("I debug", function () {
  this.debug = true;
  console.debug(
    ">> DEBUG <<",
    JSON.stringify(
      {
        request: this.request,
        response: this.response_received,
        store: this.store
      },
      null,
      2
    )
  );
});

// Fixtures seeding
Given(/^an? "(\w+)" exists/i, function (entity) {
  ensureFixture(entity);
});

// Request building
Given("the request {string} is:", function (component, docString) {
  this.request[component] = docString;
});

When(/^i make an? "(GET|POST|PUT|DELETE|PATCH|HEAD)" request to "(.*)"/i, async function (method, urlString) {
  const compileTemplate = template(urlString);
  this.request.method = method;
  this.request.url = compileTemplate(this.getTemplateContext());
  // Make request
  let driver;
  if (this.communication === "api") {
    const socketPath = this.environmentConfiguration.socketPath.Unix.replace("$HOME", process.env.HOME);
    driver = client.getApiDriver({
      timeout: 30000,
      socketPath,
      baseURL: "http://d/v3.0.0/libpod",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      }
    });
  }
  let response = {};
  try {
    response = await driver.request(this.request);
  } catch (error) {
    response.status = error.response?.status || 0;
    response.statusText = error.response?.statusText || "";
    response.headers = error.response?.headers || {};
    response.body = error.response?.body || undefined;
  }
  this.response_received = {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    body: response.data
  };
});

Then("the response {string} should be {string}", async function (component, value) {
  this.response_expected[component] = value;
});

Then("the response {string} should be:", async function (component, docString) {
  this.response_expected[component] = JSON.parse(docString);
});

Then("the {string} should be {string}", async function (path, expected) {
  this.response_matchers.push({ path, expected });
});

Then("the {string} should be:", async function (path, docString) {
  this.response_matchers.push({ path, expected: JSON.parse(docString) });
});
