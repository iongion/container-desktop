# Exit on error
$ErrorActionPreference = "Stop"
# Set-PSDebug -Trace 1

# Get the script path
$SCRIPTPATH = $MyInvocation.MyCommand.Path
if (-not (Test-Path $SCRIPTPATH)) {
    $SCRIPTPATH = Get-Command $SCRIPTPATH -ErrorAction Stop
}

# Get the directory of the script
$dir = Get-Item -LiteralPath (Split-Path -Parent $SCRIPTPATH)

# Set the script path and project home
$SCRIPTPATH = (Join-Path -Path $dir -ChildPath (Split-Path -Leaf $SCRIPTPATH)).Trim()
$PROJECT_HOME = (Split-Path -Parent $SCRIPTPATH).Trim()
$OUTPUT_DIR = Join-Path -Path $PROJECT_HOME -ChildPath "bin"
$RELAY_PATH = Join-Path -Path $OUTPUT_DIR -ChildPath "container-desktop-ssh-relay.exe"
$RELAY_PROGRAM_PATH = Join-Path -Path $OUTPUT_DIR -ChildPath "container-desktop-ssh-relay-sshd"

$env:WSL_UTF8 = 1
$WSL_USER = wsl.exe --exec whoami
$WSL_DISTRO = wsl.exe --exec bash -i -l -c 'printenv WSL_DISTRO_NAME'

# Examples
$RELAY_IDENTITY_PATH = (Join-Path -Path $env:USERPROFILE -ChildPath ".ssh/id_rsa").TrimStart().TrimEnd()
$RELAY_KNOWN_HOSTS_PATH = (Join-Path -Path $env:USERPROFILE -ChildPath ".ssh/known_hosts").TrimStart().TrimEnd()
$RELAY_NAMED_PIPE = "npipe:////./pipe/docker_engine"
$RELAY_PROGRAM_PATH = (wsl.exe --distribution "$WSL_DISTRO" --exec wslpath "$RELAY_PROGRAM_PATH")
$RELAY_PROGRAM_SSH_USER = "$WSL_USER"
$RELAY_PROGRAM_SSH_HOST = "127.0.0.1"
$RELAY_PROGRAM_SSH_PORT = 22
$RELAY_CONTEXT = (wsl.exe --exec docker context inspect --format json) | ConvertFrom-Json
$RELAY_SOCKET = $RELAY_CONTEXT[0].Endpoints.docker.Host.Replace("unix://", "")
$RELAY_SSH_CONNECTION = "ssh://${RELAY_PROGRAM_SSH_USER}@${RELAY_PROGRAM_SSH_HOST}:${RELAY_PROGRAM_SSH_PORT}${RELAY_SOCKET}"

Write-Output "Building relay inside default WSL distribution $WSL_DISTRO"
Write-Output "Launching WSL relay

$RELAY_PATH
  --identity-path ""$RELAY_IDENTITY_PATH""
  --known-hosts-path ""$RELAY_KNOWN_HOSTS_PATH""
  --named-pipe ""$RELAY_NAMED_PIPE""
  --ssh-connection ""$RELAY_SSH_CONNECTION""
  --ssh-timeout 15
"

& .\relay-build.ps1

& $RELAY_PATH `
  --identity-path "$RELAY_IDENTITY_PATH" `
  --known-hosts-path "$RELAY_KNOWN_HOSTS_PATH" `
  --named-pipe "$RELAY_NAMED_PIPE" `
  --ssh-connection "$RELAY_SSH_CONNECTION" `
  --ssh-timeout 15 `
