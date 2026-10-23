import { databaseUrl } from "./db/config.js";

/**
 * The server's environment. Every name is ledger-owned (see src/db/config.ts
 * for why never a bare DATABASE_URL).
 *
 * - LEDGER_DATABASE_URL: required. In production the runtime role
 *   `ledger_app` (SELECT, INSERT only); migrations run separately, as the owner.
 * - LEDGER_PUBLIC_PORT / LEDGER_PUBLIC_HOST: the read API. Default 8090 on
 *   every interface.
 * - LEDGER_INTERNAL_PORT / LEDGER_INTERNAL_HOST: the write path. Default 8091
 *   on loopback; set the host to a private interface only, never a public one.
 */
type Env = Readonly<Record<string, string | undefined>>;

export interface ServerConfig {
  databaseUrl: string;
  publicPort: number;
  publicHost: string;
  internalPort: number;
  internalHost: string;
}

export class ConfigError extends Error {
  override name = "ConfigError";
}

function port(env: Env, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === "") return fallback;
  if (!/^(0|[1-9][0-9]{0,4})$/.test(raw) || Number(raw) > 65535) {
    throw new ConfigError(`${name} must be a port number, got "${raw}"`);
  }
  return Number(raw);
}

function host(env: Env, name: string, fallback: string): string {
  const raw = env[name]?.trim();
  return raw === undefined || raw === "" ? fallback : raw;
}

export function serverConfig(env: Env = process.env): ServerConfig {
  const url = databaseUrl(env);
  if (url === undefined) throw new ConfigError("LEDGER_DATABASE_URL is unset");
  return {
    databaseUrl: url,
    publicPort: port(env, "LEDGER_PUBLIC_PORT", 8090),
    publicHost: host(env, "LEDGER_PUBLIC_HOST", "0.0.0.0"),
    internalPort: port(env, "LEDGER_INTERNAL_PORT", 8091),
    internalHost: host(env, "LEDGER_INTERNAL_HOST", "127.0.0.1"),
  };
}
