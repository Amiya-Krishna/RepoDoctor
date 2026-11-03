/**
 * Delivery-id validation for GitHub webhooks.
 *
 * Replay protection and the durable lifecycle live in webhook-store.ts /
 * webhook-dispatcher.ts: a delivery id is recorded (unique) in the same
 * transaction as the work it implies, instead of being "claimed" before the
 * work is safely queued.
 */
export const DELIVERY_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

export const isValidDeliveryId = (deliveryId: string): boolean => DELIVERY_ID_PATTERN.test(deliveryId);
