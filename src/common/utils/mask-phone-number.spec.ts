import { maskPhoneNumber } from './mask-phone-number';

describe('maskPhoneNumber', () => {
  it('masks an E.164 US phone number', () => {
    expect(maskPhoneNumber('+14155552671')).toBe('+1415***2671');
  });

  it('masks short phone-like values without throwing', () => {
    expect(maskPhoneNumber('+12345')).toBe('+1***45');
  });

  it('masks longer E.164 values keeping the prefix and suffix useful for correlation', () => {
    expect(maskPhoneNumber('+5511999998888')).toBe('+5511***8888');
  });
});
