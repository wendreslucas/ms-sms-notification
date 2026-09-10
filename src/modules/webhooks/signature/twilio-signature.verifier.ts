import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Twilio from 'twilio';

import { buildTwilioStatusCallbackUrl } from '../webhooks.constants';

@Injectable()
export class TwilioSignatureVerifier {
  constructor(private readonly configService: ConfigService) {}

  /**
   * Validates `X-Twilio-Signature` with the helper shipped by the official
   * Twilio SDK. Twilio signs the exact public URL it called plus the sorted POST
   * parameters, so the URL is rebuilt from PUBLIC_BASE_URL instead of from
   * request headers, which a caller could forge and which would also be wrong
   * whenever the service runs behind a TLS-terminating proxy.
   */
  verify(signature: string | undefined, params: Record<string, unknown>): boolean {
    const authToken = this.configService.get<string>('webhooks.twilio.authToken') ?? '';

    if (!authToken || !signature) {
      return false;
    }

    return Twilio.validateRequest(authToken, signature, this.buildCallbackUrl(), params);
  }

  private buildCallbackUrl(): string {
    const publicBaseUrl = this.configService.get<string>('webhooks.publicBaseUrl') ?? '';

    return buildTwilioStatusCallbackUrl(publicBaseUrl);
  }
}
