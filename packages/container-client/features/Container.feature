@read-write @integration
Feature: Container

  Background:
    Given that the environment configuration is:
      """
      {
        "machine": "podman-machine-default",
        "socketPath": {
          "Windows": "//./pipe/podman-machine-default",
          "Unix": "$HOME/.local/share/containers/podman/machine/podman-machine-default/podman.sock",
          "Native": "/tmp/podman-desktop-companion-podman-rest-api.sock"
        }
      }
      """
    And that the environment is ready
    And that this command is successful:
      """
      podman container rm --all --force
      """
    And that this command is successful:
      """
      podman run -dt -p 8889:80/tcp docker.io/library/httpd:latest
      """
    And that I store in "containers" the result of command:
      """
      podman container ls --format json
      """

  Scenario: Test containers listing
    When I make a "GET" request to "/containers/json"
    Then the response "status" should be "200"
    And the response "statusText" should be "OK"
    And the "$.response.body[0].State" should be "running"
    And the "$.response.body[0].Image" should be "docker.io/library/httpd:latest"

  Scenario: Test container reading
    When I make a "GET" request to "/containers/<%= store.containers[0].Id %>/json"
    Then the response "status" should be "200"
    And the response "statusText" should be "OK"
    And the "$.response.body.State.Status" should be "running"
    And the "$.response.body.ImageName" should be "docker.io/library/httpd:latest"

  Scenario: Test container creating
    Given the request "body" is:
      """
      {}
      """
    When I make a "POST" request to "/containers/create"
    Then I debug
    Then the response "status" should be "200"
    And the response "statusText" should be "OK"

