/**
 * Client-side stock data fetcher.
 *
 * On GitHub Pages we need a CORS proxy because Yahoo's API doesn't
 * send Access-Control-Allow-Origin headers.
 *
 * Strategy (tried in order):
 *   1. Yahoo v8 chart JSON API via each CORS proxy
 *   2. Yahoo v7 CSV download API via each CORS proxy (different
 *      endpoint — some proxies handle one better than the other)
 *   3. Direct fetch (works on localhost)
 *
 * Every response is validated as the expected format before parsing
 * so proxy error pages (HTML / plain-text) are caught gracefully.
 */

const PROXY_STRATEGIES = [
  {
    name: "corsproxy.io",
    buildUrl: (target) =>
      `https://corsproxy.io/?url=${encodeURIComponent(target)}`,
  },
  {
    name: "allorigins",
    buildUrl: (target) =>
      `https://api.allorigins.win/get?url=${encodeURIComponent(target)}`,
    envelope: true, // response wrapped in { contents: "..." }
  },
  {
    name: "codetabs",
    buildUrl: (target) =>
      `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(target)}`,
  },
  {
    name: "corsproxy.org",
    buildUrl: (target) =>
      `https://corsproxy.org/?url=${encodeURIComponent(target)}`,
  },
];

// Session cache
const _cache = {};
function cacheKey(ticker, start, end) {
  return `${ticker}_${start}_${end}`;
}

// ─── helpers ──────────────────────────────────────────────

/** Read the body as text. Never throws. */
async function bodyText(resp) {
  try {
    return await resp.text();
  } catch {
    return "";
  }
}

/** Try to parse text as JSON. Returns null on failure. */
function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Unwrap allorigins envelope if needed. */
function unwrapEnvelope(text) {
  const json = tryParseJson(text);
  if (json && typeof json.contents === "string") {
    return json.contents;
  }
  return text; // not an envelope — return raw
}

// ─── main export ──────────────────────────────────────────

export async function fetchStockData(ticker, startDate, endDate) {
  const key = cacheKey(ticker, startDate, endDate);
  if (_cache[key]) return _cache[key];

  const period1 = Math.floor(new Date(startDate).getTime() / 1000);
  const period2 = Math.floor(new Date(endDate).getTime() / 1000);

  const v8Url =
    `https://query1.finance.yahoo.com/v8/finance/chart/` +
    `${encodeURIComponent(ticker)}` +
    `?period1=${period1}&period2=${period2}&interval=1d&includeAdjustedClose=true`;

  const v7Url =
    `https://query1.finance.yahoo.com/v7/finance/download/` +
    `${encodeURIComponent(ticker)}` +
    `?period1=${period1}&period2=${period2}&interval=1d&events=history` +
    `&includeAdjustedClose=true`;

  const errors = [];

  // ── Round 1: Try v8 JSON via each proxy ─────────────────
  for (const proxy of PROXY_STRATEGIES) {
    try {
      const url = proxy.buildUrl(v8Url);
      const resp = await fetch(url);
      if (!resp.ok) {
        errors.push(`${proxy.name} v8: HTTP ${resp.status}`);
        continue;
      }

      let text = await bodyText(resp);
      if (proxy.envelope) text = unwrapEnvelope(text);

      const json = tryParseJson(text);
      if (!json || !json.chart) {
        errors.push(`${proxy.name} v8: response is not Yahoo JSON`);
        continue;
      }

      if (json.chart.error) {
        const e = json.chart.error;
        errors.push(`${proxy.name} v8: Yahoo error — ${e.description || e.code}`);
        continue;
      }

      const result = parseYahooChart(json, ticker);
      _cache[key] = result;
      return result;
    } catch (e) {
      errors.push(`${proxy.name} v8: ${e.message}`);
    }
  }

  // ── Round 2: Try v7 CSV via each proxy ──────────────────
  for (const proxy of PROXY_STRATEGIES) {
    try {
      const url = proxy.buildUrl(v7Url);
      const resp = await fetch(url);
      if (!resp.ok) {
        errors.push(`${proxy.name} v7: HTTP ${resp.status}`);
        continue;
      }

      let text = await bodyText(resp);
      if (proxy.envelope) text = unwrapEnvelope(text);

      // CSV starts with "Date,"
      if (!text.trimStart().startsWith("Date")) {
        errors.push(`${proxy.name} v7: response is not CSV`);
        continue;
      }

      const result = parseYahooCsv(text, ticker);
      _cache[key] = result;
      return result;
    } catch (e) {
      errors.push(`${proxy.name} v7: ${e.message}`);
    }
  }

  // ── Round 3: Direct fetch (localhost / CORS-disabled) ───
  for (const targetUrl of [v8Url, v7Url]) {
    try {
      const resp = await fetch(targetUrl);
      if (!resp.ok) continue;
      const text = await bodyText(resp);

      const json = tryParseJson(text);
      if (json?.chart?.result?.[0]) {
        const result = parseYahooChart(json, ticker);
        _cache[key] = result;
        return result;
      }
      if (text.trimStart().startsWith("Date")) {
        const result = parseYahooCsv(text, ticker);
        _cache[key] = result;
        return result;
      }
    } catch {
      // CORS blocked — expected
    }
  }

  throw new Error(
    `Failed to fetch data for "${ticker}". ` +
      `Tried ${errors.length} sources:\n` +
      errors.map((e) => `  - ${e}`).join("\n")
  );
}

// ─── parsers ──────────────────────────────────────────────

function parseYahooChart(json, ticker) {
  const chart = json?.chart?.result?.[0];
  if (!chart) throw new Error(`No data for "${ticker}".`);

  const timestamps = chart.timestamp;
  const quotes = chart.indicators?.quote?.[0] || {};
  const adjCloseArr = chart.indicators?.adjclose?.[0]?.adjclose;
  const closeArr = quotes.close;

  if (!timestamps || !closeArr) {
    throw new Error(`Incomplete data for "${ticker}".`);
  }

  const dates = [], prices = [], volumes = [], highs = [], lows = [], opens = [];

  for (let i = 0; i < timestamps.length; i++) {
    const p = adjCloseArr?.[i] ?? closeArr[i];
    if (p == null) continue;
    dates.push(new Date(timestamps[i] * 1000).toISOString().split("T")[0]);
    prices.push(p);
    volumes.push(quotes.volume?.[i] ?? 0);
    highs.push(quotes.high?.[i] ?? p);
    lows.push(quotes.low?.[i] ?? p);
    opens.push(quotes.open?.[i] ?? p);
  }

  if (prices.length === 0) throw new Error(`No price rows for "${ticker}".`);
  return { dates, prices, volumes, highs, lows, opens };
}

function parseYahooCsv(csvText, ticker) {
  const lines = csvText.trim().split("\n");
  if (lines.length < 2) throw new Error(`Empty CSV for "${ticker}".`);

  const hdr = lines[0].split(",").map((h) => h.trim());
  const col = (name) => hdr.indexOf(name);
  const dateIdx = col("Date");
  const priceIdx = col("Adj Close") >= 0 ? col("Adj Close") : col("Close");
  const closeIdx = col("Close");

  if (dateIdx < 0 || priceIdx < 0) {
    throw new Error(`Unexpected CSV columns for "${ticker}": ${hdr.join(",")}`);
  }

  const dates = [], prices = [], volumes = [], highs = [], lows = [], opens = [];

  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(",");
    const p = parseFloat(c[priceIdx]);
    if (isNaN(p) || !c[dateIdx] || c[dateIdx] === "null") continue;
    dates.push(c[dateIdx]);
    prices.push(p);
    volumes.push(parseInt(c[col("Volume")], 10) || 0);
    highs.push(parseFloat(c[col("High")]) || p);
    lows.push(parseFloat(c[col("Low")]) || p);
    opens.push(parseFloat(c[col("Open")]) || p);
  }

  if (prices.length === 0) throw new Error(`No valid CSV rows for "${ticker}".`);
  return { dates, prices, volumes, highs, lows, opens };
}
