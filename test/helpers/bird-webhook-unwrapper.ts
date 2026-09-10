import { Webhook } from 'standardwebhooks';

import {
  BirdWebhookClientFactory,
  BirdWebhookUnwrapper,
} from '../../src/modules/webhooks/signature/bird-webhook-client.tokens';

/**
 * Test double for the Bird webhook unwrapper.
 *
 * The official `@messagebird/sdk` package is ESM-only and Jest's module runtime
 * cannot load it, which is why the production factory is replaced here. The
 * verification itself is NOT stubbed: `bird.webhooks.unwrap` is a thin wrapper
 * around `new Webhook(secret).verify(rawBody, headers)` from the `standardwebhooks`
 * library, so this exercises the same signature and timestamp checks the SDK runs.
 */
export const testBirdWebhookClientFactory: BirdWebhookClientFactory = async (
  secret: string,
): Promise<BirdWebhookUnwrapper> => {
  const webhook = new Webhook(secret);

  return {
    unwrap: (payload: string, headers: Record<string, string>): unknown =>
      webhook.verify(payload, headers),
  };
};
