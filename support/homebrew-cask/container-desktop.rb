cask "container-desktop" do
  version "<VERSION>"
  sha256 "<SHA256>"

  url "https://github.com/iongion/container-desktop/releases/download/#{version}/container-desktop-mac-arm64-#{version}.dmg",
      verified: "github.com/iongion/container-desktop/"
  name "Container Desktop"
  desc "General purpose container operations"
  homepage "https://container-desktop.com/"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true
  depends_on arch: :arm64
  depends_on macos: ">= :catalina"

  app "Container Desktop.app"

  uninstall quit:   "io.github.iongion.ContainerDesktop",
            delete: "/Applications/Container Desktop.app",
            trash:  "~/Library/LaunchAgents/io.github.iongion.ContainerDesktop.plist"

  zap trash: [
    "~/.local/share/container-desktop",
    "~/Library/Application Support/Container Desktop",
    "~/Library/Preferences/io.github.iongion.ContainerDesktop.plist",
    "~/Library/Saved Application State/io.github.iongion.ContainerDesktop.savedState",
  ]
end
