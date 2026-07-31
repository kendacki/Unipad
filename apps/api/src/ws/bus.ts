import { EventEmitter } from "node:events";

type Handler = (payload: unknown) => void;

class Bus {
  private ee = new EventEmitter();

  constructor() {
    this.ee.setMaxListeners(200);
  }

  publish(channel: string, payload: unknown) {
    this.ee.emit(channel, payload);
    this.ee.emit("*", { channel, payload });
  }

  subscribe(channel: string, handler: Handler) {
    this.ee.on(channel, handler);
    return () => this.ee.off(channel, handler);
  }
}

export const bus = new Bus();
