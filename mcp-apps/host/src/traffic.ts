/**
 * Records every JSON-RPC message the host sends or receives, on both links:
 *   - host <-> MCP server   (Streamable HTTP)
 *   - host <-> each view    (postMessage via the sandbox proxy)
 * The right-hand panel renders this list. Watching it is the fastest way to
 * learn the protocol (same idea as the AG-UI events panel next door).
 */
import type { JSONRPCMessage, Transport, TransportSendOptions } from "@modelcontextprotocol/client";
import { useSyncExternalStore } from "react";

export interface TrafficEntry {
  seq: number;
  at: number;
  link: string; // "server" or "view:weather#1a2b"
  dir: "out" | "in"; // out = host sends, in = host receives
  msg: JSONRPCMessage;
}

let entries: TrafficEntry[] = [];
let seq = 0;
const listeners = new Set<() => void>();

export function record(link: string, dir: "out" | "in", msg: JSONRPCMessage) {
  entries = [...entries, { seq: seq++, at: Date.now(), link, dir, msg }];
  listeners.forEach((l) => l());
}

export function clearTraffic() {
  entries = [];
  listeners.forEach((l) => l());
}

export function useTraffic(): TrafficEntry[] {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => entries,
  );
}

/** Wraps any MCP Transport and records what goes through it. */
export class LoggingTransport implements Transport {
  onmessage?: Transport["onmessage"];
  onclose?: () => void;
  onerror?: (error: Error) => void;

  constructor(
    private inner: Transport,
    private link: string,
  ) {
    inner.onmessage = (msg, extra) => {
      record(this.link, "in", msg);
      this.onmessage?.(msg, extra);
    };
    inner.onclose = () => this.onclose?.();
    inner.onerror = (e) => this.onerror?.(e);
  }

  get sessionId() {
    return this.inner.sessionId;
  }

  start() {
    return this.inner.start();
  }

  send(msg: JSONRPCMessage, options?: TransportSendOptions) {
    record(this.link, "out", msg);
    return this.inner.send(msg, options);
  }

  close() {
    return this.inner.close();
  }
}
