// In-tree, typed replacement for the slice of `electron-context-menu` this app actually used
// (`contextMenu({ window, showInspectElement: true })`). Rather than vendor the whole feature-rich
// package, we implement just the standard right-click menu: editing roles, copy selection, link +
// image actions, and Inspect Element. Built from Electron primitives so there is no external dep.

import {
  type BrowserWindow,
  type ContextMenuParams,
  clipboard,
  Menu,
  type MenuItemConstructorOptions,
  shell,
} from "electron";

export interface ContextMenuOptions {
  window: BrowserWindow;
  showInspectElement?: boolean;
  showSelectAll?: boolean;
}

function buildTemplate(
  window: BrowserWindow,
  props: ContextMenuParams,
  options: ContextMenuOptions,
): MenuItemConstructorOptions[] {
  const { editFlags } = props;
  const hasText = props.selectionText.trim().length > 0;
  const template: MenuItemConstructorOptions[] = [];
  const separate = () => {
    if (template.length > 0 && template[template.length - 1]?.type !== "separator") {
      template.push({ type: "separator" });
    }
  };

  if (props.isEditable) {
    template.push(
      { role: "undo", enabled: editFlags.canUndo },
      { role: "redo", enabled: editFlags.canRedo },
      { type: "separator" },
      { role: "cut", enabled: editFlags.canCut },
      { role: "copy", enabled: editFlags.canCopy },
      { role: "paste", enabled: editFlags.canPaste },
    );
    if (options.showSelectAll ?? true) {
      template.push({ role: "selectAll", enabled: editFlags.canSelectAll });
    }
  } else if (hasText) {
    template.push({ role: "copy", enabled: editFlags.canCopy });
  }

  if (props.linkURL) {
    const linkURL = props.linkURL;
    separate();
    template.push(
      { label: "Copy Link Address", click: () => clipboard.writeText(linkURL) },
      { label: "Open Link in Browser", click: () => void shell.openExternal(linkURL) },
    );
  }

  if (props.mediaType === "image") {
    const srcURL = props.srcURL;
    separate();
    template.push({ label: "Copy Image", click: () => window.webContents.copyImageAt(props.x, props.y) });
    if (srcURL) {
      template.push({ label: "Save Image As…", click: () => window.webContents.downloadURL(srcURL) });
    }
  }

  if (options.showInspectElement ?? true) {
    separate();
    template.push({
      label: "Inspect Element",
      click: () => {
        window.webContents.inspectElement(props.x, props.y);
        if (window.webContents.isDevToolsOpened()) {
          window.webContents.devToolsWebContents?.focus();
        }
      },
    });
  }

  return template;
}

/** Attach a standard right-click context menu to `options.window`. */
export function createContextMenu(options: ContextMenuOptions): void {
  options.window.webContents.on("context-menu", (_event, props) => {
    const template = buildTemplate(options.window, props, options);
    if (template.length === 0) {
      return;
    }
    Menu.buildFromTemplate(template).popup({ window: options.window });
  });
}
