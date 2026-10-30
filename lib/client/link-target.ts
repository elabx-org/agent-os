/**
 * Where a link a session printed should open: localhost:<port> through the
 * port proxy (M16), so a dev server's "http://localhost:5173" works from
 * the phone. Anything else as it is. No React, for the terminal's links.
 */

import { parseLoopbackUrl, proxyUrlFor } from "@/lib/proxy-url";

interface LinkProxy {
  enabled: boolean;
  subdomainBase: string | null;
}

// The proxy's on unless turned off: until its settings load, path mode
let proxy: LinkProxy = { enabled: true, subdomainBase: null };
let loading: Promise<void> | null = null;

/** Loads the proxy's settings once, ahead of the first click */
export function loadLinkProxy(): Promise<void> {
  loading ??= fetch("/api/ports?only=config")
    .then((res) => (res.ok ? res.json() : null))
    .then((body: { proxy?: LinkProxy } | null) => {
      if (body?.proxy)
        proxy = {
          enabled: !!body.proxy.enabled,
          subdomainBase: body.proxy.subdomainBase ?? null,
        };
    })
    .catch(() => {
      loading = null;
    });
  return loading;
}

/** The URL to open for `uri`, from `origin` (where AgentOS is open) */
export function linkTarget(
  uri: string,
  origin: string,
  settings: LinkProxy = proxy
): string {
  const target = parseLoopbackUrl(uri);
  if (!target) return uri;
  return proxyUrlFor(target.port, target.path, {
    origin,
    subdomainBase: settings.subdomainBase,
    enabled: settings.enabled,
  });
}

/** Opens a link from a session (the iOS app opens it in Safari) */
export function openSessionLink(uri: string) {
  window.open(linkTarget(uri, window.location.origin), "_blank", "noopener");
}
