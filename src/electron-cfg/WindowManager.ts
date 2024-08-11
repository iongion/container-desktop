import { utils } from "./utils";

export class WindowManager {
  protected opts: any;
  protected store: any;
  protected logger: any;
  protected window: any;
  protected stateChangeTimer?: any;

  constructor(opts, store, logger) {
    this.opts = opts;
    this.store = store;
    this.logger = logger;

    this.onStateChanged = this.onStateChanged.bind(this);
    this.onClose = this.onClose.bind(this);
    this.onClosed = this.onClosed.bind(this);
    this.save = this.save.bind(this);
  }

  create(options: Electron.BrowserWindowConstructorOptions = {}) {
    const BrowserWindow = utils.getBrowserWindow();

    const win: Electron.BrowserWindow = new BrowserWindow({ ...options, ...this.options() });
    this.assign(win);
    return win;
  }

  assign(win: Electron.BrowserWindow) {
    if (!win || win === this.window) {
      return;
    }
    if (this.window) {
      throw new Error(`Another window has been attached as ${this.opts.name}`);
    }
    this.window = win;
    const { isFullScreen, isMaximized } = this.getState();
    const { saveFullscreen, saveMaximize } = this.opts;
    if (saveMaximize && isMaximized) {
      win.maximize();
    }
    if (saveFullscreen && isFullScreen) {
      win.setFullScreen(true);
    }
    win.on("resize", this.onStateChanged);
    win.on("move", this.onStateChanged);
    win.on("close", this.onClose);
    win.on("closed", this.onClosed);
  }

  options() {
    const state = this.getState();

    if (!validateState(state, this.logger)) {
      if (this.logger && this.logger.debug) {
        let resetMessage =
          `electron-cfg: Reset window '${this.opts.name}' ` + ` state, previous:${JSON.stringify(state)}. `;

        try {
          const displays = utils.getScreen().getAllDisplays();
          resetMessage += "Displays: " + JSON.stringify(displays);
        } catch (e) {
          // Nothing to do more
        }

        this.logger.debug(resetMessage);
      }

      return {};
    }

    return {
      width: state.width,
      height: state.height,
      x: state.x,
      y: state.y
    };
  }

  unassign() {
    const window = this.window;

    if (!window) {
      return;
    }

    window.removeListener("resize", this.onStateChanged);
    window.removeListener("move", this.onStateChanged);
    clearTimeout(this.stateChangeTimer);
    window.removeListener("close", this.onClose);
    window.removeListener("closed", this.onClosed);

    this.window = null;
  }

  getState() {
    return this.store.get(`windowState.${this.opts.name}`, {});
  }

  setState(value) {
    this.store.set(`windowState.${this.opts.name}`, value);
  }

  save() {
    const window = this.window;
    if (!window) return;

    let state;
    try {
      state = {
        isMaximized: window.isMaximized(),
        isFullScreen: window.isFullScreen(),
        ...(isNormal(window) ? window.getBounds() : this.options())
      };
    } catch (err) {
      // Don't throw an error when window was closed
    }

    if (state) {
      this.setState(state);
    }
  }

  onStateChanged() {
    clearTimeout(this.stateChangeTimer);
    this.stateChangeTimer = setTimeout(this.save, 300);
  }

  onClose() {
    this.save();
  }

  onClosed() {
    this.unassign();
    this.save();
  }
}

export function isNormal(win) {
  return !win.isMaximized() && !win.isMinimized() && !win.isFullScreen();
}

export function validateState(state, logger) {
  const isValidValues =
    state &&
    Number.isInteger(state.x) &&
    Number.isInteger(state.y) &&
    Number.isInteger(state.width) &&
    state.width >= 64 &&
    Number.isInteger(state.height) &&
    state.height >= 48;

  if (!isValidValues) {
    return false;
  }

  let screen;
  try {
    screen = utils.getScreen();
  } catch (e) {
    logger.warn(e);
    return false;
  }

  return screen.getAllDisplays().some((d) => isRectInBounds(state, d.bounds));
}

export function isRectInBounds(rect, bounds) {
  return (
    rect.x >= bounds.x &&
    rect.y >= bounds.y &&
    rect.x + rect.width <= bounds.x + bounds.width &&
    rect.y + rect.height <= bounds.y + bounds.height
  );
}
