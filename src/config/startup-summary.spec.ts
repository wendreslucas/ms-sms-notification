import {
  buildStartupSummary,
  formatStartupSummary,
  normalizeApplicationUrl,
} from './startup-summary';

describe('normalizeApplicationUrl', () => {
  it.each([
    ['http://[::1]:3000', 'http://localhost:3000'],
    ['http://[::]:3000', 'http://localhost:3000'],
    ['http://0.0.0.0:3000', 'http://localhost:3000'],
    ['http://127.0.0.1:3000', 'http://localhost:3000'],
    ['http://localhost:3000', 'http://localhost:3000'],
    ['https://sms.example.com', 'https://sms.example.com'],
  ])('rewrites %s to %s', (input, expected) => {
    expect(normalizeApplicationUrl(input)).toBe(expected);
  });

  it('drops trailing slashes so URLs are not doubled up', () => {
    expect(normalizeApplicationUrl('http://localhost:3000//')).toBe('http://localhost:3000');
  });

  it('leaves a host that merely contains a normalized address alone', () => {
    expect(normalizeApplicationUrl('https://0.0.0.0.example.com')).toBe(
      'https://0.0.0.0.example.com',
    );
  });
});

describe('buildStartupSummary', () => {
  it('derives every URL from the routes the application registers', () => {
    const summary = buildStartupSummary({
      environment: 'development',
      applicationUrl: 'http://[::1]:3000',
    });

    expect(summary).toMatchObject({
      environment: 'development',
      applicationUrl: 'http://localhost:3000',
      swaggerUrl: 'http://localhost:3000/api/docs',
      healthUrl: 'http://localhost:3000/api/health',
      twilioWebhookUrl: 'http://localhost:3000/api/v1/webhooks/twilio',
      birdWebhookUrl: 'http://localhost:3000/api/v1/webhooks/bird',
    });
  });

  it('reports public webhook URLs when PUBLIC_BASE_URL points elsewhere', () => {
    const summary = buildStartupSummary({
      environment: 'production',
      applicationUrl: 'http://0.0.0.0:3000',
      publicBaseUrl: 'https://sms.example.com/',
    });

    expect(summary.publicBaseUrl).toBe('https://sms.example.com');
    expect(summary.publicTwilioWebhookUrl).toBe('https://sms.example.com/api/v1/webhooks/twilio');
    expect(summary.publicBirdWebhookUrl).toBe('https://sms.example.com/api/v1/webhooks/bird');
  });

  it('does not claim a public URL when PUBLIC_BASE_URL is absent', () => {
    const summary = buildStartupSummary({
      environment: 'development',
      applicationUrl: 'http://localhost:3000',
    });

    expect(summary.publicBaseUrl).toBeNull();
    expect(summary.publicTwilioWebhookUrl).toBeNull();
    expect(summary.publicBirdWebhookUrl).toBeNull();
  });

  it('does not claim a public URL when PUBLIC_BASE_URL still points at this instance', () => {
    const summary = buildStartupSummary({
      environment: 'development',
      applicationUrl: 'http://[::1]:3000',
      publicBaseUrl: 'http://localhost:3000',
    });

    expect(summary.publicBaseUrl).toBeNull();
  });
});

describe('formatStartupSummary', () => {
  it('renders the local block and warns that providers cannot reach it', () => {
    const output = formatStartupSummary(
      buildStartupSummary({
        environment: 'development',
        applicationUrl: 'http://localhost:3000',
      }),
    );

    expect(output).toContain('Environment : development');
    expect(output).toContain('Application : http://localhost:3000');
    expect(output).toContain('Swagger     : http://localhost:3000/api/docs');
    expect(output).toContain('Health      : http://localhost:3000/api/health');
    expect(output).toContain('Twilio      : http://localhost:3000/api/v1/webhooks/twilio');
    expect(output).toContain('Bird        : http://localhost:3000/api/v1/webhooks/bird');
    expect(output).toContain('PUBLIC_BASE_URL is not set to a publicly reachable origin');
    expect(output).not.toContain('Public URL');
  });

  it('renders both local and public webhook URLs when they differ', () => {
    const output = formatStartupSummary(
      buildStartupSummary({
        environment: 'production',
        applicationUrl: 'http://localhost:3000',
        publicBaseUrl: 'https://sms.example.com',
      }),
    );

    expect(output).toContain('Public URL  : https://sms.example.com');
    expect(output).toContain('Webhooks (local)');
    expect(output).toContain('Webhooks (public, as the providers reach them)');
    expect(output).toContain('Twilio      : https://sms.example.com/api/v1/webhooks/twilio');
    expect(output).not.toContain('PUBLIC_BASE_URL is not set');
  });

  it('stays plain text so it does not disturb a terminal or a log collector', () => {
    const output = formatStartupSummary(
      buildStartupSummary({
        environment: 'development',
        applicationUrl: 'http://localhost:3000',
      }),
    );

    // No ANSI escapes and no characters outside the printable ASCII range.
    // eslint-disable-next-line no-control-regex
    expect(output).not.toMatch(/\[/);
    expect(output.replace(/\n/g, '')).toMatch(/^[\x20-\x7e]+$/);
  });
});
