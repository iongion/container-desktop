import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import St from "gi://St";

import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";

const TOGGLE_ARG = "--container-desktop-gnome-tray-toggle";

function configPath() {
  const configHome = GLib.getenv("XDG_CONFIG_HOME") || GLib.build_filenamev([GLib.get_home_dir(), ".config"]);
  return GLib.build_filenamev([configHome, "container-desktop", "gnome-tray-bridge.json"]);
}

function fallbackSocketPath() {
  const runtimeDir = GLib.getenv("XDG_RUNTIME_DIR") || GLib.get_tmp_dir();
  return GLib.build_filenamev([runtimeDir, "container-desktop", "gnome-tray-bridge.sock"]);
}

function readConfig() {
  try {
    const [ok, contents] = GLib.file_get_contents(configPath());
    if (!ok) {
      return {};
    }
    return JSON.parse(new TextDecoder().decode(contents));
  } catch {
    return {};
  }
}

function actorBounds(actor) {
  const [x, y] = actor.get_transformed_position();
  const [width, height] = actor.get_transformed_size();
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function isCancelled(error) {
  return error instanceof GLib.Error && error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}

// Fire-and-forget JSON-line writer. Runs entirely off the compositor thread:
// connect_async -> write_bytes_async -> close_async, each finished in its callback.
// On connect failure (e.g. app not running) onFailure() is invoked so the caller
// can fall through to spawning the app. cancellable may be null for best-effort
// sends that must outlive disable() (e.g. the final "disabled" notification).
function sendBridgeMessage(config, message, cancellable, onFailure) {
  const socketPath = config.socketPath || fallbackSocketPath();
  const payload = new GLib.Bytes(new TextEncoder().encode(`${JSON.stringify(message)}\n`));
  const client = new Gio.SocketClient();
  client.connect_async(Gio.UnixSocketAddress.new(socketPath), cancellable, (source, connectResult) => {
    let connection = null;
    try {
      connection = source.connect_finish(connectResult);
    } catch (error) {
      if (!isCancelled(error)) {
        onFailure?.();
      }
      return;
    }
    connection
      .get_output_stream()
      .write_bytes_async(payload, GLib.PRIORITY_DEFAULT, cancellable, (stream, writeResult) => {
        try {
          stream.write_bytes_finish(writeResult);
        } catch (error) {
          if (!isCancelled(error)) {
            logError(error, "container-desktop-tray: failed to write bridge message");
          }
        }
        connection.close_async(GLib.PRIORITY_DEFAULT, null, (conn, closeResult) => {
          try {
            conn.close_finish(closeResult);
          } catch {
            // Best effort only.
          }
        });
      });
  });
}

function spawnApp(config, bounds) {
  if (!config.command) {
    return false;
  }
  try {
    const argv = [
      config.command,
      ...(Array.isArray(config.args) ? config.args : []),
      TOGGLE_ARG,
      String(bounds.x),
      String(bounds.y),
      String(bounds.width),
      String(bounds.height),
    ];
    const launcher = new Gio.SubprocessLauncher({ flags: Gio.SubprocessFlags.NONE });
    if (config.cwd) {
      launcher.set_cwd(config.cwd);
    }
    launcher.spawnv(argv);
    return true;
  } catch {
    return false;
  }
}

const ContainerDesktopIndicator = GObject.registerClass(
  class ContainerDesktopIndicator extends PanelMenu.Button {
    _init() {
      super._init(0.5, "Container Desktop", true);

      this._cancellable = new Gio.Cancellable();
      this._icon = new St.Icon({ style_class: "system-status-icon" });
      this.add_child(this._icon);
      this._refreshIcon();

      // Handle the press ourselves and stop it so the default PanelMenu.Button
      // menu toggle never runs — the button only ever sends a bridge message.
      // This avoids touching the private _clickGesture field, whose API is not
      // stable across GNOME Shell 45–50.
      this._pressId = this.connect("button-press-event", (_actor, event) => {
        const button = event.get_button();
        if (button !== Clutter.BUTTON_PRIMARY && button !== Clutter.BUTTON_SECONDARY) {
          return Clutter.EVENT_PROPAGATE;
        }
        this._toggleTray();
        return Clutter.EVENT_STOP;
      });
    }

    notifyReady() {
      sendBridgeMessage(readConfig(), { type: "ready" }, this._cancellable);
    }

    notifyDisabled() {
      // Best-effort and must survive teardown, so it is intentionally not tied
      // to this._cancellable (which is cancelled in destroy()).
      sendBridgeMessage(readConfig(), { type: "disabled" }, null);
    }

    _refreshIcon() {
      const config = readConfig();
      if (config.iconPath && GLib.file_test(config.iconPath, GLib.FileTest.EXISTS)) {
        this._icon.gicon = Gio.icon_new_for_string(config.iconPath);
        return;
      }
      this._icon.icon_name = "application-x-executable-symbolic";
    }

    _toggleTray() {
      const config = readConfig();
      const bounds = actorBounds(this);
      this._refreshIcon();
      // If the socket connect fails (app not running) fall through to spawning
      // the configured command. This runs in the async connect callback.
      sendBridgeMessage(config, { type: "toggle", bounds }, this._cancellable, () => spawnApp(config, bounds));
    }

    destroy() {
      if (this._pressId) {
        this.disconnect(this._pressId);
        this._pressId = 0;
      }
      if (this._cancellable) {
        this._cancellable.cancel();
        this._cancellable = null;
      }
      this._icon = null;
      super.destroy();
    }
  },
);

export default class ContainerDesktopTrayExtension extends Extension {
  enable() {
    this._indicator = new ContainerDesktopIndicator();
    Main.panel.addToStatusArea(this.uuid, this._indicator, 0, "right");
    this._indicator.notifyReady();
  }

  disable() {
    if (!this._indicator) {
      return;
    }
    this._indicator.notifyDisabled();
    this._indicator.destroy();
    this._indicator = null;
  }
}
