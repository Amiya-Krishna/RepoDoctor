/**
 * Replay / duplicate protection for GitHub webhooks.
 *
 * GitHub gives every delivery a unique X-GitHub-Delivery id. A valid
 * signature proves authenticity but not freshness, so an attacker who captured
 * a delivery could replay it. Each id is accepted once; the first writer wins
 * (atomic insert on a primary key), later ones are rejected as replays.
 */
export interface DeliveryStore {
  /** Returns true if the id was new and is now recorded; false if already seen. */
  claim(deliveryId: string, event: string): Promise<boolean>;
}

export const DELIVERY_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

export async function claimDelivery(
  store: DeliveryStore,
  deliveryId: string,
  event: string,
): Promise<"new" | "replay" | "invalid"> {
  if (!DELIVERY_ID_PATTERN.test(deliveryId)) return "invalid";
  return (await store.claim(deliveryId, event)) ? "new" : "replay";
}

export const prismaDeliveryStore: DeliveryStore = {
  async claim(deliveryId, event) {
    const { prisma } = await import("../config/prisma.js");
    try {
      await prisma.webhookDelivery.create({ data: { deliveryId, event } });
      return true;
    } catch (error: any) {
      if (error?.code === "P2002") return false; // unique violation => already processed
      throw error; // storage failure: caller must fail closed
    }
  },
};
