
Param
(
    [parameter(Mandatory = $true)]
    [string]
    $Version,
    [parameter(Mandatory = $false)]
    [string]
    $Token
)

function Get-HashForArchitecture {
    param (
        [parameter(Mandatory = $true)]
        [string]
        $Architecture,
        [parameter(Mandatory = $true)]
        [string]
        $Version
    )
    $url = "https://github.com/iongion/container-desktop/releases/download/$Version/container-desktop-$Architecture-$Version.exe.sha256"
    Write-Host "Obtaining hash for $Architecture from $url"
    $hash = (new-object Net.WebClient).DownloadString($url)
    return $hash.Trim()
}

function Write-MetaData {
    param (
        [parameter(Mandatory = $true)]
        [string]
        $FileName,
        [parameter(Mandatory = $true)]
        [string]
        $Version,
        [parameter(Mandatory = $true)]
        [string]
        $HashAmd64
    )
    $content = Get-Content $FileName -Raw
    $content = $content.Replace('<VERSION>', $Version)
    $content = $content.Replace('<HASH-AMD64>', $HashAmd64)
    $date = Get-Date -Format "yyyy-MM-dd"
    $content = $content.Replace('<DATE>', $date)
    $content | Out-File -Encoding 'UTF8' "./release/$Version/$FileName"
}

New-Item -Path $PWD -Name "./release/$Version" -ItemType "directory"
# Get all files inside the folder and adjust the version/hash
$HashAmd64 = Get-HashForArchitecture -Architecture 'x64' -Version $Version
Get-ChildItem '*.yaml' | ForEach-Object -Process {
    Write-MetaData -FileName $_.Name -Version $Version -HashAmd64 $HashAmd64
}
# Install the latest wingetcreate exe
# Need to do things this way, see https://github.com/PowerShell/PowerShell/issues/13138
Import-Module Appx -UseWindowsPowerShell

# Download and install C++ Runtime framework package.
# $vcLibsBundleFile = "$PWD\release\$Version\Microsoft.VCLibs.x64.14.00.Desktop.appx"
# Invoke-WebRequest "https://aka.ms/Microsoft.VCLibs.x64.14.00.Desktop.appx" -OutFile $vcLibsBundleFile
# Add-AppxPackage $vcLibsBundleFile

# Download Winget-Create msixbundle, install, and execute update.
$appxBundleFile = "$PWD\release\container-desktop-x64-$Version.appx"
# Add-AppxPackage $appxBundleFile
Add-AppxPackage -Path "$PWD\release\__appx-x64\AppxManifest.xml" -Register

# Create the PR
if (-not $Token) {
  return
}
wingetcreate submit --token $Token $Version
