@read-write @integration
Feature: Container

  Background:
    Given that the environment configuration is:
      """
      {
        "machine": "podman-machine-default",
        "soketPath": {
          "Windows_NT": "//./pipe/podman-machine-default",
          "Darwin": "$HOME/.local/share/containers/podman/machine/podman-machine-default/podman.sock",
          "Linux": "/tmp/podman-desktop-companion-podman-rest-api.sock"
        }
      }
      """
    And that the environment is ready
    And that this command is successful:
      """
      podman run -dt -p 8889:80/tcp docker.io/library/httpd:latest
      """

  Scenario: Test containers listing
    When I make a "GET" request to "/containers/json"
    Then the response "status" should be "200"
    And the response "statusText" should be "OK"
    And the response "$.body[0].State" should be "running"
