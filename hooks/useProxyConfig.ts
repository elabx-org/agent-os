"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { proxyUrlFor } from "@/lib/proxy-url";

export interface ProxySettings {
  enabled: boolean;
  mode: "path" | "path+subdomain";
  subdomainBase: string | null;
  sandbox: boolean;
}

/** The port proxy's settings, from /api/ports (no port scan) */
export function useProxyConfig(): ProxySettings | undefined {
  const { data } = useQuery({
    queryKey: ["proxy-config"],
    queryFn: async (): Promise<ProxySettings> => {
      const res = await fetch("/api/ports?only=config");
      if (!res.ok) throw new Error(`ports ${res.status}`);
      return ((await res.json()) as { proxy: ProxySettings }).proxy;
    },
    staleTime: 60_000,
  });
  return data;
}

/**
 * Builds links to apps on container ports from where Agent-OS is open:
 * /proxy/<port>/ (or the port host) remotely, localhost when local or
 * when the proxy is off. Before settings load, links stay localhost.
 */
export function useProxyUrl(): (port: number, path?: string) => string {
  const config = useProxyConfig();
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => setOrigin(window.location.origin), []);
  return useCallback(
    (port: number, path = "/") =>
      proxyUrlFor(port, path, {
        origin: origin ?? "http://localhost",
        subdomainBase: config?.subdomainBase ?? null,
        enabled: !!config?.enabled,
      }),
    [config, origin]
  );
}
