/**
 * Client-side stock data fetcher using Yahoo Finance v8 chart API.
 * Uses a CORS proxy for browser access.  Falls back across multiple
 * free proxies so the app is resilient.
 *
 * Returns: { dates: string[], prices: number[] }  (adjusted close or close)
 */

const PROXIES = [
  "https://corsproxy.io/?",
  "https://api.allorigins.win/raw?url=",
  "https://api.codetabs.com/v1/proxy?quest=",
];

// Local cache so we don't re-fetch the same ticker+range twice per session
const _cache = {};

function cacheKey(ticker, start, end) {
  return `${ticker}_${start}_${end}`;
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

  let lastErr = null;

  for (const proxy of PROXIES) {
    try {
      const url = proxy + encodeURIComponent(baseUrl);
      const resp = await fetch(url);
      if (!resp.ok) continue;
      const json = await resp.json();
      const result = parseYahooChart(json, ticker);
      _cache[key] = result;
      return result;
    } catch (e) {
      lastErr = e;
    }
  }

  // Fallback: try direct (works if site has its own proxy or local dev)
  try {
    const resp = await fetch(baseUrl);
    if (resp.ok) {
      const json = await resp.json();
      const result = parseYahooChart(json, ticker);
      _cache[key] = result;
      return result;
    }
  } catch (_) {
    /* ignore */
  }

  throw new Error(
    `Failed to fetch data for "${ticker}". ${lastErr?.message || "All proxies failed."}`
  );
}

function parseYahooChart(json, ticker) {
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

  // Filter out nulls (weekends/holidays already excluded by Yahoo)
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

  return { dates, prices, volumes, highs, lows, opens };
}
