/**
 * Client-side stock data fetcher using Yahoo Finance v8 chart API.
 *
 * On GitHub Pages (or any static host) we need a CORS proxy because
 * Yahoo's API doesn't send Access-Control-Allow-Origin headers.
 *
 * Strategy:
 *   1. Try each proxy in order.
 *   2. Validate that the response is actually JSON before parsing
 *      (proxies often return HTML error pages on rate-limit / block).
 *   3. Fall back to direct fetch (works on localhost or if browser
 *      extensions disable CORS).
 *
 * Returns: { dates: string[], prices: number[], volumes: number[],
 *            highs: number[], lows: number[], opens: number[] }
 */

// Each entry: { buildUrl: (targetUrl) => proxyUrl, unwrap?: (response) => json }
const PROXY_STRATEGIES = [
  {
    name: "corsproxy.io",
    buildUrl: (target) => `https://corsproxy.io/?url=${encodeURIComponent(target)}`,
  },
  {
    name: "api.allorigins.win",
    buildUrl: (target) => `https://api.allorigins.win/get?url=${encodeURIComponent(target)}`,
    // allorigins wraps the response in { contents: "..." }
    unwrap: async (resp) => {
      const wrapper = await resp.json();
      if (!wrapper.contents) throw new Error("allorigins returned empty contents");
      return JSON.parse(wrapper.contents);
    },
  },
  {
    name: "api.codetabs.com",
    buildUrl: (target) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(target)}`,
  },
  {
    name: "corsproxy.org",
    buildUrl: (target) => `https://corsproxy.org/?url=${encodeURIComponent(target)}`,
  },
];

// Session cache
const _cache = {};

function cacheKey(ticker, start, end) {
  return `${ticker}_${start}_${end}`;
}

/**
 * Attempt to parse a fetch Response as Yahoo Finance JSON.
 * Returns the parsed JSON or throws if the body isn't valid JSON
 * (e.g. an HTML error page from the proxy).
 */
async function safeJsonParse(resp) {
  const text = await resp.text();

  // Quick sanity check — Yahoo JSON always starts with '{'
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("{")) {
    // Likely an HTML error page from the proxy
    const preview = trimmed.slice(0, 120).replace(/\n/g, " ");
    throw new Error(`Response is not JSON: "${preview}..."`);
  }

  return JSON.parse(text);
}

/**
 * Download daily OHLCV for `ticker` between two YYYY-MM-DD date strings.
 */
export async function fetchStockData(ticker, startDate, endDate) {
  const key = cacheKey(ticker, startDate, endDate);
  if (_cache[key]) return _cache[key];

  const period1 = Math.floor(new Date(startDate).getTime() / 1000);
  const period2 = Math.floor(new Date(endDate).getTime() / 1000);
  const baseUrl =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?period1=${period1}&period2=${period2}&interval=1d&includeAdjustedClose=true`;

  const errors = [];

  // Try each proxy strategy
  for (const strategy of PROXY_STRATEGIES) {
    try {
      const url = strategy.buildUrl(baseUrl);
      const resp = await fetch(url);

      if (!resp.ok) {
        errors.push(`${strategy.name}: HTTP ${resp.status}`);
        continue;
      }

      let json;
      if (strategy.unwrap) {
        json = await strategy.unwrap(resp);
      } else {
        json = await safeJsonParse(resp);
      }

      const result = parseYahooChart(json, ticker);
      _cache[key] = result;
      return result;
    } catch (e) {
      errors.push(`${strategy.name}: ${e.message}`);
    }
  }

  // Fallback: direct fetch (works on localhost / dev servers)
  try {
    const resp = await fetch(baseUrl);
    if (resp.ok) {
      const json = await safeJsonParse(resp);
      const result = parseYahooChart(json, ticker);
      _cache[key] = result;
      return result;
    }
    errors.push(`direct: HTTP ${resp.status}`);
  } catch (e) {
    errors.push(`direct: ${e.message}`);
  }

  throw new Error(
    `Failed to fetch data for "${ticker}". Tried ${errors.length} sources:\n` +
      errors.map((e) => `  - ${e}`).join("\n")
  );
}

function parseYahooChart(json, ticker) {
  // Yahoo sometimes returns an error object
  if (json?.chart?.error) {
    const err = json.chart.error;
    throw new Error(`Yahoo Finance error for "${ticker}": ${err.description || err.code}`);
  }

  const chart = json?.chart?.result?.[0];
  if (!chart) throw new Error(`No data returned for "${ticker}".`);

  const timestamps = chart.timestamp;
  const adjClose =
    chart.indicators?.adjclose?.[0]?.adjclose ||
    chart.indicators?.quote?.[0]?.close;
  const close = chart.indicators?.quote?.[0]?.close;
  const volume = chart.indicators?.quote?.[0]?.volume;
  const high = chart.indicators?.quote?.[0]?.high;
  const low = chart.indicators?.quote?.[0]?.low;
  const open = chart.indicators?.quote?.[0]?.open;

  if (!timestamps || !close) {
    throw new Error(`Incomplete data for "${ticker}".`);
  }

  const dates = [];
  const prices = [];
  const volumes = [];
  const highs = [];
  const lows = [];
  const opens = [];

  for (let i = 0; i < timestamps.length; i++) {
    const p = adjClose?.[i] ?? close[i];
    if (p == null) continue;
    dates.push(new Date(timestamps[i] * 1000).toISOString().split("T")[0]);
    prices.push(p);
    volumes.push(volume?.[i] ?? 0);
    highs.push(high?.[i] ?? p);
    lows.push(low?.[i] ?? p);
    opens.push(open?.[i] ?? p);
  }

  if (prices.length === 0) {
    throw new Error(`No price data found for "${ticker}" in the given date range.`);
  }

  return { dates, prices, volumes, highs, lows, opens };
}
