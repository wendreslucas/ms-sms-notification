/**
 * Names of the built-in providers, for code that has to refer to one of them
 * directly, such as its webhook. The registry is keyed by each provider's own
 * `providerName`, so a new provider does not need an entry here.
 */
export enum SmsProviderName {
  TWILIO = 'twilio',
  BIRD = 'bird',
}
