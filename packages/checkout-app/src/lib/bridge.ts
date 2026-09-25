import {
  PROTOCOL_SOURCE,
  PROTOCOL_VERSION,
  type CheckoutMessage,
  type Envelope,
  type LaunchParams,
} from "@nimbus-goods/sdk/protocol";

export interface Bridge {
  send(message: CheckoutMessage): void;
}

/**
 * The only way anything leaves the checkout. Messages go to exactly one origin (the host
 * the SDK told us about), never "*", and only carry what's in the protocol types.
 */
export function createBridge(launch: LaunchParams): Bridge {
  return {
    send(message) {
      const envelope: Envelope = {
        source: PROTOCOL_SOURCE,
        v: PROTOCOL_VERSION,
        channel: launch.channel,
        type: message.type,
        payload: message.payload,
      };
      window.parent.postMessage(envelope, launch.hostOrigin);
    },
  };
}

export function randomId(length: number): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (const b of crypto.getRandomValues(new Uint8Array(length))) out += alphabet[b % alphabet.length];
  return out;
}
