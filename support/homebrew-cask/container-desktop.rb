cask "container-desktop" do
  arch arm: "arm64", intel: "x64"

  version "5.2.13"
  sha256 arm:   "4e14f9b0b0f936aea1ca3433ba58fe963bbcaad331880586062e8d37c7b9df51",
         intel: "43a4cbe20b06d439006a8c9c6cf826400be859f7b66fc42aa777466edef8d017"

  url "https://github.com/iongion/container-desktop/releases/download/#{version}/container-desktop-#{arch}-#{version}.dmg",
      verified: "github.com/iongion/container-desktop/"
  name "Container Desktop"
  desc "General purpose container operations"
  homepage "https://container-desktop.com/"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true
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
