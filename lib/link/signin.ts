/**
 * Signing in to what stands in front of the hub (e.g. Authelia), so the
 * link's dial-out gets through it. Filled in by `agent-os link`: tokens
 * are kept with the machine's key and refreshed here.
 */

export interface SignInConfig {
  /** OpenID Connect issuer, e.g. https://auth.example.com */
  issuer: string;
  clientId: string;
}

export async function signInHeaders(
  _hubUrl: string,
  _config: SignInConfig
): Promise<Record<string, string>> {
  return {};
}
