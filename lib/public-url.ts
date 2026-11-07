export function publicBaseUrl(requestUrl?: string) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL || process.env.AUTH_URL || process.env.NEXTAUTH_URL;
  if (configured) return configured.replace(/\/$/, "");
  if (requestUrl) return new URL(requestUrl).origin;
  return "http://localhost:3000";
}

export function publicTeamUrl(slug: string, requestUrl?: string) {
  return `${publicBaseUrl(requestUrl)}/teams/${encodeURIComponent(slug)}`;
}
