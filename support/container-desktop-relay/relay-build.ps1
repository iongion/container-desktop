# Exit on error
$ErrorActionPreference = "Stop"

# Get the script path
$SCRIPTPATH = $MyInvocation.MyCommand.Path
if (-not (Test-Path $SCRIPTPATH)) {
    $SCRIPTPATH = Get-Command $SCRIPTPATH -ErrorAction Stop
}

# Get the directory of the script
$dir = Get-Item -LiteralPath (Split-Path -Parent $SCRIPTPATH)

# Set the script path and project home
$SCRIPTPATH = Join-Path -Path $dir -ChildPath (Split-Path -Leaf $SCRIPTPATH)
$PROJECT_HOME = Split-Path -Parent $SCRIPTPATH
$OUTPUT_DIR = Join-Path -Path $PROJECT_HOME -ChildPath "bin"


# Create the bin directory if it doesn't exist
Write-Output "Ensuring output dir exists in $OUTPUT_DIR"
if (-not (Test-Path $OUTPUT_DIR)) {
    New-Item -ItemType Directory -Path $OUTPUT_DIR
}

# # Build for Windows
Write-Output "Building windows relay binary"
$env:GOOS = "windows"
$env:GOARCH = "amd64"
go.exe build --ldflags '-s -w' -o "$OUTPUT_DIR/container-desktop-ssh-relay.exe"

Write-Output "Building WSL ssh relay server binary"
$env:GOOS = "linux"
$env:GOARCH = "amd64"
go.exe build --ldflags '-s -w' -o "$OUTPUT_DIR/container-desktop-ssh-relay-sshd"
