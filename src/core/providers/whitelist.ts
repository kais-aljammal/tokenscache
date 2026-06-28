export const ALLOWED_PROVIDER_DOMAINS = ["anthropic.com", "openai.com", "googleapis.com"] as const;

export function isAllowedProviderHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return ALLOWED_PROVIDER_DOMAINS.some(
    (domain) => normalized === domain || normalized.endsWith(`.${domain}`),
  );
}

export function isAllowedUpstreamUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      isAllowedProviderHost(parsed.hostname)
    );
  } catch {
    return false;
  }
}
