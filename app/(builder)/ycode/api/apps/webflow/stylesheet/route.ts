import { lookup } from 'dns/promises';
import { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
// DNS resolution + arbitrary outbound fetch need the Node runtime.
export const runtime = 'nodejs';

/**
 * GET /ycode/api/apps/webflow/stylesheet
 *
 * Server-side proxy for a Webflow site's published stylesheet. Fetching it
 * from the builder directly would hit CORS; routing through the server avoids
 * that. Supports two modes:
 *
 *   ?url=<published .css URL>   Fetch a specific website-files.com stylesheet.
 *   ?site=<published site URL>  Auto-discover the shared stylesheet from a
 *                               published site (e.g. https://my-site.webflow.io).
 *
 * `?site=` is preferred for stored connections: Webflow's shared CSS filename
 * carries a content fingerprint that changes on every republish, so we
 * re-discover the current URL from the live page rather than persisting a URL
 * that goes stale.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  const site = request.nextUrl.searchParams.get('site');

  if (!url && !site) {
    return noCache({ error: 'Provide a `url` or `site` parameter' }, 400);
  }

  try {
    if (url) {
      const parsed = parseStylesheetUrl(url);
      if (!parsed) {
        return noCache(
          { error: 'Only Webflow website-files.com stylesheets are allowed' },
          400,
        );
      }
      const css = await fetchText(parsed.toString());
      return noCache({ data: { css, stylesheetUrl: parsed.toString() } });
    }

    // `site` mode: fetch the published page, find its shared stylesheet link.
    const pageUrl = normalizeSiteUrl(site!);
    if (!pageUrl) {
      return noCache({ error: 'Enter a valid published site URL' }, 400);
    }

    // SSRF guard: only fetch hosts that resolve to public IPs.
    if (!(await isPublicHost(pageUrl.hostname))) {
      return noCache({ error: 'That site host is not allowed' }, 400);
    }

    const html = await fetchText(pageUrl.toString());
    const stylesheetUrl = findStylesheetUrl(html);
    if (!stylesheetUrl) {
      return noCache(
        {
          error:
            'No Webflow stylesheet found on that page. Make sure the site is published and the URL is correct.',
        },
        404,
      );
    }

    const css = await fetchText(stylesheetUrl);
    return noCache({ data: { css, stylesheetUrl } });
  } catch (error) {
    console.error('Error fetching Webflow stylesheet:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to fetch stylesheet' },
      502,
    );
  }
}

// =============================================================================
// Helpers
// =============================================================================

/** Validate a direct stylesheet URL — must be an https website-files.com asset. */
function parseStylesheetUrl(input: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return null;
  }
  const ok =
    parsed.protocol === 'https:' &&
    /(^|\.)website-files\.com$/.test(parsed.hostname);
  return ok ? parsed : null;
}

/**
 * Normalize a user-entered site URL (bare domain or full URL) to an https URL,
 * rejecting hosts that could be used for SSRF (loopback / private ranges).
 */
function normalizeSiteUrl(input: string): URL | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  // Always fetch over https and only allow web ports.
  parsed.protocol = 'https:';
  if (parsed.port && parsed.port !== '443') return null;

  return parsed;
}

/**
 * SSRF guard. A host is safe to fetch only if it isn't an internal name and
 * every IP it resolves to is public. We resolve DNS rather than just screening
 * literals so a public domain pointing at a private IP is still rejected.
 *
 * Note: this doesn't fully close DNS-rebinding (the address could change between
 * lookup and fetch) — acceptable for an authenticated, tenant-scoped tool. Pin
 * to the resolved IP at the agent level if that ever matters.
 */
async function isPublicHost(hostname: string): Promise<boolean> {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    return false;
  }
  if (isPrivateIp(host)) return false; // host is itself an IP literal

  try {
    const addresses = await lookup(host, { all: true });
    if (addresses.length === 0) return false;
    return addresses.every((a) => !isPrivateIp(a.address));
  } catch {
    return false;
  }
}

/** True for loopback, link-local, CGNAT and RFC-1918 private addresses. */
function isPrivateIp(ip: string): boolean {
  const v6 = ip.toLowerCase();
  if (v6 === '::1' || v6 === '::') return true;
  if (v6.startsWith('fe80') || v6.startsWith('fc') || v6.startsWith('fd')) return true;

  // Unwrap IPv4-mapped IPv6 (e.g. ::ffff:10.0.0.1).
  const mapped = v6.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  const v4 = mapped ? mapped[1] : ip;

  const m = v4.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC-1918
  if (a === 192 && b === 168) return true; // RFC-1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

/** Find the first Webflow shared stylesheet link in a published page's HTML. */
function findStylesheetUrl(html: string): string | null {
  const matches = html.match(
    /https?:\/\/[^"'\s)]*website-files\.com\/[^"'\s)]+\.css/gi,
  );
  if (!matches || matches.length === 0) return null;
  // Prefer the generated "*.webflow.shared.*.css" bundle (the global stylesheet).
  return matches.find((m) => /\.webflow\.(shared|)\.?[^/]*\.css/i.test(m)) ?? matches[0];
}

async function fetchText(target: string): Promise<string> {
  const res = await fetch(target, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Upstream returned ${res.status}`);
  }
  return res.text();
}
