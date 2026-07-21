// Ambient global surface. The host-capability interfaces themselves now live in @/platform/contract
// (the importable PORT the Tauri backend implements); here we re-alias them into the global scope and declare
// the `window.*` / global `var` bindings the host bridge exposes — so existing ambient callers
// (e.g. `const Command: ICommand = ...` with no import) keep resolving unchanged, while the port has one
// concrete, checkable source of truth.

import type { IAI as _IAI, IAIBus as _IAIBus } from "@/ai-system/host/aiClientBridge";
import type { SSHHost as _SSHHost } from "@/container-client/Types";
import type {
  IActivityBus as _IActivityBus,
  ICommand as _ICommand,
  IFileSystem as _IFileSystem,
  IMessageBus as _IMessageBus,
  IPath as _IPath,
  IPlatform as _IPlatform,
  IResourceBus as _IResourceBus,
  ITrayBus as _ITrayBus,
  StreamHandle as _StreamHandle,
} from "@/platform/contract";

declare global {
  // Re-alias the port interfaces into the ambient global scope (source of truth: @/platform/contract).
  type SSHHost = _SSHHost;
  type StreamHandle = _StreamHandle;
  type ICommand = _ICommand;
  type IPlatform = _IPlatform;
  type IPath = _IPath;
  type IFileSystem = _IFileSystem;
  type IMessageBus = _IMessageBus;
  type IActivityBus = _IActivityBus;
  type ITrayBus = _ITrayBus;
  type IResourceBus = _IResourceBus;
  // Host-exposed AI bridges — types imported from @/ai-system/core (see platform/*/aiClient.ts / aiBus.ts).
  type IAI = _IAI;
  type IAIBus = _IAIBus;

  var Platform: IPlatform;
  var Command: ICommand;
  var Path: IPath;
  var FS: IFileSystem;
  var CURRENT_OS_TYPE: OperatingSystem;
  var CURRENT_DARWIN_MAJOR: number | undefined;
  var MessageBus: IMessageBus;
  var ActivityBus: IActivityBus;
  var TrayBus: ITrayBus;
  var ResourceBus: IResourceBus;
  var AI: IAI;
  var AIBus: IAIBus;
  var CONTAINER_DESKTOP_MOCK: string;

  interface Window {
    Platform: IPlatform;
    Command: ICommand;
    Path: IPath;
    FS: IFileSystem;
    CURRENT_OS_TYPE: any;
    CURRENT_DARWIN_MAJOR: number | undefined;
    MessageBus: IMessageBus;
    ActivityBus: IActivityBus;
    TrayBus: ITrayBus;
    ResourceBus: IResourceBus;
    AI: IAI;
    AIBus: IAIBus;
    CONTAINER_DESKTOP_MOCK: string;
  }
}

export default global;
