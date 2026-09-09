import type { SmsMessage } from '@messagebird/sdk';

export interface BirdSmsClient {
  sms: {
    send(
      params: {
        to: string;
        from: string;
        text: string;
        category: 'transactional';
      },
      options?: { idempotencyKey?: string },
    ): Promise<SmsMessage>;
  };
}

export type BirdClientFactory = (apiKey: string) => Promise<BirdSmsClient>;

export const BIRD_CLIENT_FACTORY = 'BIRD_CLIENT_FACTORY';

interface BirdSdkModule {
  BirdClient: new (options: { apiKey: string }) => BirdSmsClient;
}

export const defaultBirdClientFactory: BirdClientFactory = (apiKey) => {
  return import('@messagebird/sdk').then((birdSdk: BirdSdkModule) => {
    return new birdSdk.BirdClient({ apiKey });
  });
};
