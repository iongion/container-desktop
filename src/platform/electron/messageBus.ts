import * as Electron from "electron";
import fixPath from "fix-path";

fixPath();

export const MessageBus: IMessageBus = {
  send: (channel: string, ...data: any[]) => Electron.ipcRenderer.send(channel, ...data),
  invoke: async (channel: string, ...data: any[]) => await Electron.ipcRenderer.invoke(channel, ...data),
};
