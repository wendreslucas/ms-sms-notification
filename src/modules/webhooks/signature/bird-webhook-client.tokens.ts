export interface BirdWebhookUnwrapper {
  unwrap(payload: string, headers: Record<string, string>, options?: { secret?: string }): unknown;
}

export type BirdWebhookClientFactory = (secret: string) => Promise<BirdWebhookUnwrapper>;

export const BIRD_WEBHOOK_CLIENT_FACTORY = 'BIRD_WEBHOOK_CLIENT_FACTORY';

interface BirdSdkModule {
  BirdClient: new (options: { webhooks: { secret: string } }) => {
    webhooks: BirdWebhookUnwrapper;
  };
}

/**
 * Builds a receiver-only Bird client. The official SDK allows omitting `apiKey`
 * when the client is used exclusively to unwrap webhooks, so the webhook signing
 * secret never has to travel alongside the API key.
 */
export const defaultBirdWebhookClientFactory: BirdWebhookClientFactory = (secret) => {
  return import('@messagebird/sdk').then((birdSdk: BirdSdkModule) => {
    return new birdSdk.BirdClient({ webhooks: { secret } }).webhooks;
  });
};
