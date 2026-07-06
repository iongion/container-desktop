// Build-time shim for `@popperjs/core` (see popperCoreShim() in vite.config.renderer.mjs).
//
// @popperjs/core's barrel (lib/index.js) does `export * from "./enums.js"`, and enums.js declares the
// placement/phase enums as COMPUTED vars (`export var placements = /*#__PURE__*/[...].reduce(...)`).
// Vite 8 / rolldown 1.1.3 fails to surface those computed names through the wildcard re-export, so
// Blueprint's `import { placements } from "@popperjs/core"` breaks the renderer build with MISSING_EXPORT.
// esbuild (dev pre-bundle) follows the star fine, so this shim is applied for `vite build` only.
//
// It mirrors lib/index.js exactly, but re-exports every enum EXPLICITLY (rolldown resolves explicit named
// re-exports without trouble). The sub-path specifiers below are not the bare "@popperjs/core", so the
// resolveId hook ignores them and they resolve normally — no recursion.

export { createPopper as createPopperBase, detectOverflow, popperGenerator } from "@popperjs/core/lib/createPopper.js";
export {
  afterMain,
  afterRead,
  afterWrite,
  auto,
  basePlacements,
  beforeMain,
  beforeRead,
  beforeWrite,
  bottom,
  clippingParents,
  end,
  left,
  main,
  modifierPhases,
  placements,
  popper,
  read,
  reference,
  right,
  start,
  top,
  variationPlacements,
  viewport,
  write,
} from "@popperjs/core/lib/enums.js";
export {
  applyStyles,
  arrow,
  computeStyles,
  eventListeners,
  flip,
  hide,
  offset,
  popperOffsets,
  preventOverflow,
} from "@popperjs/core/lib/modifiers/index.js";
export { createPopper } from "@popperjs/core/lib/popper.js";
export { createPopper as createPopperLite } from "@popperjs/core/lib/popper-lite.js";
