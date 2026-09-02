const canonicalOrigin = (value: string): string | undefined => {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
};

export const configuredLoopbackOrigin = (
  name: string,
  raw: string | undefined,
  fallback: string,
): string => {
  const value = raw?.trim() || fallback;
  const origin = canonicalOrigin(value);
  if (!origin) throw new Error(`${name} must be a valid origin.`);
  const url = new URL(origin);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1")
    throw new Error(`${name} must use http://127.0.0.1 with an optional port.`);
  return origin;
};

/** Reject browser and DNS-rebinding requests outside the configured loopback origin. */
export const isAllowedWebRequest = (request: Request, allowedOrigin: string): boolean => {
  const expectedOrigin = canonicalOrigin(allowedOrigin);
  if (!expectedOrigin) return false;
  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== expectedOrigin) return false;
  const host = request.headers.get("host");
  if (host && host.toLocaleLowerCase() !== new URL(expectedOrigin).host.toLocaleLowerCase())
    return false;
  const origin = request.headers.get("origin");
  return origin === null || canonicalOrigin(origin) === expectedOrigin;
};
