/**
 * GET /api/prices?ticker=AAPL&start=2021-10-07&end=2026-10-07
 *
 * Server-side relay for daily price history. The upstream sources do not
 * send CORS headers, so a browser cannot call them directly.
 *
 * Responds with { source, dates, prices, volumes, highs, lows, opens },
 * oldest bar first. Sources are tried in a fixed order, not raced, so the
 * same request keeps returning the same series.
 */
import { parseYahooChart, parseNasdaqJson } from "../src/data/parsers.js";

// Keep this short: Yahoo answers 429 to a full browser User-Agent that
// arrives without cookies.
const USER_AGENT = "Mozilla/5.0";

const TICKER_RE = /^[A-Z0-9][A-Z0-9.-]{0,9}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UPSTREAM_TIMEOUT_MS = 8000;

async function fetchJson(url) {
  const resp = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

// ─── sources ─────────────────────────────────────────────

/**
 * Yahoo reports the session in progress as a daily bar with the latest
 * trade as its close and only part of the day's volume. Drop a bar dated
 * today (UTC) so every bar is a finished trading day.
 */
function dropUnfinishedBar(data) {
  const today = new Date().toISOString().split("T")[0];
  if (data.dates[data.dates.length - 1] < today) return data;
  if (data.dates.length === 1) throw new Error("only an unfinished bar in range");
  return Object.fromEntries(Object.entries(data).map(([k, arr]) => [k, arr.slice(0, -1)]));
}

function yahoo(host) {
  return async (ticker, start, end) => {
    const p1 = Math.floor(Date.parse(start) / 1000);
    const p2 = Math.floor(Date.parse(end) / 1000) + 86400; // include the end date
    const symbol = ticker.replace(/\./g, "-"); // Yahoo writes share classes as BRK-B
    const json = await fetchJson(
      `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}` +
      `?period1=${p1}&period2=${p2}&interval=1d&includeAdjustedClose=true`
    );
    if (json?.chart?.error) throw new Error(json.chart.error.description);
    if (!json?.chart?.result?.[0]) throw new Error("not chart JSON");
    return dropUnfinishedBar(parseYahooChart(json, ticker));
  };
}

function nasdaq(assetClass) {
  return async (ticker, start, end) => {
    const json = await fetchJson(
      `https://api.nasdaq.com/api/quote/${encodeURIComponent(ticker)}/historical` +
      `?assetclass=${assetClass}&fromdate=${start}&todate=${end}&limit=9999&type=1`
    );
    return parseNasdaqJson(json, ticker);
  };
}

const SOURCES = [
  ["yahoo", yahoo("query1.finance.yahoo.com")],
  ["yahoo", yahoo("query2.finance.yahoo.com")],
  ["nasdaq", nasdaq("stocks")],
  ["nasdaq", nasdaq("etf")],
];

// ─── handler ─────────────────────────────────────────────

function json(body, status, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const ticker = (params.get("ticker") ?? "").trim().toUpperCase();
  const start = params.get("start") ?? "";
  const end = params.get("end") ?? "";

  if (!TICKER_RE.test(ticker)) {
    return json({ error: "ticker must be 1–10 letters, digits, dots or dashes" }, 400);
  }
  if (!DATE_RE.test(start) || !DATE_RE.test(end) ||
      Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end)) || start >= end) {
    return json({ error: "start and end must be YYYY-MM-DD dates, start before end" }, 400);
  }

  const attempts = [];
  for (const [source, load] of SOURCES) {
    try {
      const data = await load(ticker, start, end);
      // Price history only changes once a day; let the CDN absorb repeats
      return json({ source, ...data }, 200, {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      });
    } catch (err) {
      attempts.push(`${source}: ${err.message}`);
    }
  }

  return json({ error: `No price source returned data for "${ticker}".`, attempts }, 502);
}
