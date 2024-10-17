import EventEmitter from "eventemitter3";
import { v4 } from "uuid";

export interface IEventEmitterTransmitter {
  transmit(event: string, data: any): void;
}

type SystemNotifier = EventEmitter & IEventEmitterTransmitter;

export const systemNotifier = new EventEmitter() as SystemNotifier;
systemNotifier.transmit = (event: string, data: any) => {
  systemNotifier.emit(event, {
    guid: v4(),
    date: new Date(),
    type: event,
    data: data,
  });
};
