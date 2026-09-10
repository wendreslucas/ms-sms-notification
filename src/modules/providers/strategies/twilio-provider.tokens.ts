import Twilio from 'twilio';

export interface TwilioMessageClient {
  messages: {
    create(options: {
      to: string;
      from: string;
      body: string;
      statusCallback?: string;
    }): Promise<{ sid: string }>;
  };
}

export type TwilioClientFactory = (accountSid: string, authToken: string) => TwilioMessageClient;

export const TWILIO_CLIENT_FACTORY = 'TWILIO_CLIENT_FACTORY';

export const defaultTwilioClientFactory: TwilioClientFactory = (accountSid, authToken) =>
  Twilio(accountSid, authToken, {
    autoRetry: false,
    maxRetries: 0,
  });
