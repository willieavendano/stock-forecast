/**
 * Client-side stock data fetcher.
 *
 * Data source priority:
 *   1. Alpha Vantage (CORS-enabled, works directly from browser)
 *      — only when the user supplies a free API key from alphavantage.co
 *   2. /api/prices — this app's own server function, which relays price
 *      history from sources that do not allow browser requests
 *   3. Yahoo Finance direct and via public CORS proxies (last resort, for
 *      hosts with no server function; unreliable)
 *
 * Alpha Vantage free tier: 25 requests/day. Results are cached per
 * session so repeated fetches for the same ticker don't consume quota.
 */

import { parseYahooChart, parseStooqCsv, parseNasdaqJson } from "./parsers";

// ─── session cache ───────────────────────────────────────

const _cache = {};
function cacheKey(ticker, start, end) {
  return `${ticker}_${start}_${end}`;
}

// ─── Alpha Vantage (primary) ─────────────────────────────

async function fetchAlphaVantage(ticker, startDate, endDate, apiKey) {
  const url =
    `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY_ADJUSTED` +
    `&symbol=${encodeURIComponent(ticker)}&outputsize=full&apikey=${apiKey}`;

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Alpha Vantage HTTP ${resp.status}`);

  const data = await resp.json();

  // Check for AV error messages
  if (data["Error Message"]) {
    throw new Error(`Alpha Vantage: ${data["Error Message"]}`);
  }
  if (data["Note"]) {
    // Rate limit message
    throw new Error(`Alpha Vantage rate limit: ${data["Note"]}`);
  }
  if (data["Information"]) {
    throw new Error(`Alpha Vantage: ${data["Information"]}`);
  }

  const timeSeries = data["Time Series (Daily)"];
  if (!timeSeries) {
    throw new Error(`Alpha Vantage returned no time series for "${ticker}".`);
  }

  // AV returns all history, we need to filter to [startDate, endDate]
  const allDates = Object.keys(timeSeries).sort(); // ascending
  const dates = [], prices = [], volumes = [], highs = [], lows = [], opens = [];

  for (const d of allDates) {
    if (d < startDate || d > endDate) continue;
    const row = timeSeries[d];
    const adjClose = parseFloat(row["5. adjusted close"]);
    const close = parseFloat(row["4. close"]);
    const p = isNaN(adjClose) ? close : adjClose;
    if (isNaN(p)) continue;

    dates.push(d);
    prices.push(p);
    volumes.push(parseInt(row["6. volume"], 10) || 0);
    highs.push(parseFloat(row["2. high"]) || p);
    lows.push(parseFloat(row["3. low"]) || p);
    opens.push(parseFloat(row["1. open"]) || p);
  }

  if (prices.length === 0) {
    throw new Error(`No Alpha Vantage data for "${ticker}" in range ${startDate} to ${endDate}.`);
  }

  return { dates, prices, volumes, highs, lows, opens };
}

// ─── Price proxy (no API key) ────────────────────────────

async function fetchProxy(ticker, startDate, endDate) {
  const url =
    `${import.meta.env.BASE_URL}api/prices?ticker=${encodeURIComponent(ticker)}` +
    `&start=${startDate}&end=${endDate}`;

  const resp = await fetchWithTimeout(url, 25000);
  // A static host answers this path with an HTML page, which parses to null
  const json = tryParseJson(await bodyText(resp));
  if (!resp.ok) throw new Error(json?.error ?? `price proxy: HTTP ${resp.status}`);
  if (!json?.prices?.length) throw new Error("price proxy: not available on this host");
  return json;
}

// ─── Free fallback (no API key, no proxy) ────────────────
//
// Races four approaches in parallel — first success wins:
//   1. Yahoo Finance chart API direct (query1 + query2) — works when Yahoo
//      serves Access-Control-Allow-Origin: * (browser/region dependent)
//   2. NASDAQ public API direct — api.nasdaq.com is the backend for nasdaq.com
//      itself, so it sometimes allows broad CORS origins
//   3. Yahoo Finance v8 JSON via CORS proxies — proxies return JSON we can parse
//   4. Stooq CSV direct — succeeds on localhost, blocked in production

const PROXIES = [
  {
    name: "corsproxy.io",
    buildUrl: (t) => `https://corsproxy.io/?url=${encodeURIComponent(t)}`,
  },
  {
    name: "allorigins-raw",
    buildUrl: (t) => `https://api.allorigins.win/raw?url=${encodeURIComponent(t)}`,
  },
  {
    name: "allorigins",
    buildUrl: (t) => `https://api.allorigins.win/get?url=${encodeURIComponent(t)}`,
    envelope: true,
  },
  {
    name: "codetabs",
    buildUrl: (t) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(t)}`,
  },
  {
    name: "corsproxy.org",
    buildUrl: (t) => `https://corsproxy.org/?url=${encodeURIComponent(t)}`,
  },
];

function tryParseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

async function bodyText(resp) {
  try { return await resp.text(); } catch { return ""; }
}

function unwrap(text) {
  const j = tryParseJson(text);
  return j && typeof j.contents === "string" ? j.contents : text;
}

function fetchWithTimeout(url, ms = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

// ─── fallback fetch (no API key) ─────────────────────────

async function fetchFallback(ticker, startDate, endDate, proxyError) {
  const p1 = Math.floor(new Date(startDate).getTime() / 1000);
  const p2 = Math.floor(new Date(endDate).getTime() / 1000);
  const d1 = startDate.replace(/-/g, "");
  const d2 = endDate.replace(/-/g, "");

  const yahooParams = `?period1=${p1}&period2=${p2}&interval=1d&includeAdjustedClose=true`;
  const yahooQ1 = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}${yahooParams}`;
  const yahooQ2 = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}${yahooParams}`;
  const nasdaqUrl =
    `https://api.nasdaq.com/api/quote/${encodeURIComponent(ticker)}/historical` +
    `?assetclass=stocks&fromdate=${startDate}&todate=${endDate}&limit=9999&type=1`;
  const stooqUrl =
    `https://stooq.com/q/d/l/?s=${encodeURIComponent(ticker.toLowerCase())}.us` +
    `&d1=${d1}&d2=${d2}&i=d`;

  // Attempt Yahoo Finance direct
  const tryYahooDirect = async (url, label) => {
    const resp = await fetchWithTimeout(url, 10000);
    if (!resp.ok) throw new Error(`${label}: HTTP ${resp.status}`);
    const json = tryParseJson(await bodyText(resp));
    if (!json?.chart?.result?.[0]) throw new Error(`${label}: not chart JSON`);
    if (json.chart.error) throw new Error(`${label}: ${json.chart.error.description}`);
    return parseYahooChart(json, ticker);
  };

  // Attempt Yahoo Finance v8 JSON through a CORS proxy
  const tryYahooViaProxy = async (proxy) => {
    const resp = await fetchWithTimeout(proxy.buildUrl(yahooQ1));
    if (!resp.ok) throw new Error(`${proxy.name}/yahoo: HTTP ${resp.status}`);
    let text = await bodyText(resp);
    if (proxy.envelope) text = unwrap(text);
    const json = tryParseJson(text);
    if (!json?.chart?.result?.[0]) throw new Error(`${proxy.name}/yahoo: not chart JSON`);
    if (json.chart.error) throw new Error(`${proxy.name}/yahoo: ${json.chart.error.description}`);
    return parseYahooChart(json, ticker);
  };

  // Attempt NASDAQ public API direct
  const tryNasdaq = async () => {
    const resp = await fetchWithTimeout(nasdaqUrl, 10000);
    if (!resp.ok) throw new Error(`nasdaq: HTTP ${resp.status}`);
    const json = tryParseJson(await bodyText(resp));
    return parseNasdaqJson(json, ticker);
  };

  // Attempt Stooq CSV direct (succeeds on localhost)
  const tryStooqDirect = async () => {
    const resp = await fetchWithTimeout(stooqUrl, 8000);
    if (!resp.ok) throw new Error(`stooq-direct: HTTP ${resp.status}`);
    const text = await bodyText(resp);
    if (!text.trimStart().startsWith("Date")) throw new Error("stooq-direct: not CSV");
    return parseStooqCsv(text, ticker);
  };

  // Race everything in parallel — first success wins
  const attempts = [
    tryYahooDirect(yahooQ1, "yahoo-q1"),
    tryYahooDirect(yahooQ2, "yahoo-q2"),
    tryNasdaq(),
    tryStooqDirect(),
    ...PROXIES.map(tryYahooViaProxy),
  ];

  try {
    return await Promise.any(attempts);
  } catch (agg) {
    const details = [proxyError, ...(agg.errors ?? [])].map((e) => `  • ${e.message}`).join("\n");
    throw new Error(
      `All data sources failed for "${ticker}".\n\n` +
      `Fix: enter a free Alpha Vantage API key in the API Key field above.\n` +
      `Get one in 60 seconds (no credit card): alphavantage.co/support/#api-key\n\n` +
      `Attempted:\n${details}`
    );
  }
}

// ─── main export ─────────────────────────────────────────

/**
 * Fetch stock data. Uses Alpha Vantage if apiKey is provided, then this
 * app's /api/prices function, then a parallel race of public sources.
 * The result carries a `source` name when the price proxy supplied it.
 */
export async function fetchStockData(ticker, startDate, endDate, apiKey) {
  const key = cacheKey(ticker, startDate, endDate);
  if (_cache[key]) return _cache[key];

  // Strategy 1: Alpha Vantage (reliable, always CORS-enabled)
  if (apiKey) {
    try {
      const result = await fetchAlphaVantage(ticker, startDate, endDate, apiKey);
      _cache[key] = result;
      return result;
    } catch (avErr) {
      console.warn("Alpha Vantage failed, trying the price proxy:", avErr.message);
    }
  }

  // Strategy 2: this app's own price proxy
  let proxyError;
  try {
    const result = await fetchProxy(ticker, startDate, endDate);
    _cache[key] = result;
    return result;
  } catch (err) {
    proxyError = err;
    console.warn("Price proxy failed, trying public sources:", err.message);
  }

  // Strategy 3: Yahoo direct + Stooq via proxies (parallel race)
  const result = await fetchFallback(ticker, startDate, endDate, proxyError);
  _cache[key] = result;
  return result;
}
