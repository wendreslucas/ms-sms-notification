export function maskPhoneNumber(phone: string): string {
  if (phone.length <= 7) {
    return `${phone.slice(0, 2)}***${phone.slice(-2)}`;
  }

  return `${phone.slice(0, 5)}***${phone.slice(-4)}`;
}
