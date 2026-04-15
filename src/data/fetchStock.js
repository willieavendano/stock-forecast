/**
 * Client-side stock data fetcher.
 *
 * Data source priority:
 *   1. Alpha Vantage (CORS-enabled, works directly from browser)
 *      — requires a free API key from alphavantage.co
 *   2. Yahoo Finance via CORS proxies (fallback, unreliable)
 *   3. Direct Yahoo fetch (localhost only)
 *
 * Alpha Vantage free tier: 25 requests/day. Results are cached per
 * session so repeated fetches for the same ticker don't consume quota.
 */

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

// ─── Free fallback (no API key) ──────────────────────────
//
// Races three approaches in parallel — first success wins:
//   1. Yahoo Finance chart API direct (query1 + query2 servers)
//      Yahoo's chart endpoint sometimes carries Access-Control-Allow-Origin: *
//      for widget embeds, making it the fastest no-key path when it works.
//   2. Stooq plain-CSV direct (succeeds on localhost without CORS issues)
//   3. Stooq via public CORS proxies (last resort for deployed/production use)

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

// ─── parsers ─────────────────────────────────────────────

function parseYahooChart(json, ticker) {
  const chart = json.chart.result[0];
  const ts = chart.timestamp;
  const q = chart.indicators?.quote?.[0] || {};
  const adj = chart.indicators?.adjclose?.[0]?.adjclose;
  if (!ts || !q.close) throw new Error(`Incomplete Yahoo chart data for "${ticker}".`);

  const dates = [], prices = [], volumes = [], highs = [], lows = [], opens = [];
  for (let i = 0; i < ts.length; i++) {
    const p = adj?.[i] ?? q.close[i];
    if (p == null || isNaN(p)) continue;
    dates.push(new Date(ts[i] * 1000).toISOString().split("T")[0]);
    prices.push(p);
    volumes.push(q.volume?.[i] ?? 0);
    highs.push(q.high?.[i] ?? p);
    lows.push(q.low?.[i] ?? p);
    opens.push(q.open?.[i] ?? p);
  }
  if (!prices.length) throw new Error(`No price rows for "${ticker}".`);
  return { dates, prices, volumes, highs, lows, opens };
}

function parseStooqCsv(csv, ticker) {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) throw new Error(`Empty Stooq CSV for "${ticker}".`);

  const hdr = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const ci = (n) => hdr.indexOf(n);
  const dateI = ci("date"), closeI = ci("close");
  const openI = ci("open"), highI = ci("high"), lowI = ci("low"), volI = ci("volume");

  if (dateI < 0 || closeI < 0)
    throw new Error(`Unexpected Stooq columns for "${ticker}": ${hdr.join(",")}`);

  const dates = [], prices = [], volumes = [], highs = [], lows = [], opens = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(",");
    const p = parseFloat(c[closeI]);
    if (isNaN(p) || !c[dateI]) continue;
    dates.push(c[dateI].trim());
    prices.push(p);
    volumes.push(volI >= 0 ? (parseInt(c[volI], 10) || 0) : 0);
    highs.push(highI >= 0 ? (parseFloat(c[highI]) || p) : p);
    lows.push(lowI >= 0 ? (parseFloat(c[lowI]) || p) : p);
    opens.push(openI >= 0 ? (parseFloat(c[openI]) || p) : p);
  }
  if (!prices.length) throw new Error(`No valid rows in Stooq CSV for "${ticker}".`);

  // Stooq returns newest-first — reverse to ascending chronological order
  if (dates.length > 1 && dates[0] > dates[dates.length - 1]) {
    dates.reverse(); prices.reverse(); volumes.reverse();
    highs.reverse(); lows.reverse(); opens.reverse();
  }
  return { dates, prices, volumes, highs, lows, opens };
}

// ─── fallback fetch (no API key) ─────────────────────────

async function fetchFallback(ticker, startDate, endDate) {
  const p1 = Math.floor(new Date(startDate).getTime() / 1000);
  const p2 = Math.floor(new Date(endDate).getTime() / 1000);
  const d1 = startDate.replace(/-/g, "");
  const d2 = endDate.replace(/-/g, "");

  const yahooBase =
    `?period1=${p1}&period2=${p2}&interval=1d&includeAdjustedClose=true`;
  const yahooQ1 =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}${yahooBase}`;
  const yahooQ2 =
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}${yahooBase}`;
  const stooqUrl =
    `https://stooq.com/q/d/l/?s=${encodeURIComponent(ticker.toLowerCase())}.us` +
    `&d1=${d1}&d2=${d2}&i=d`;

  // Helper: attempt a Yahoo direct fetch
  const tryYahoo = async (url, label) => {
    const resp = await fetchWithTimeout(url, 10000);
    if (!resp.ok) throw new Error(`${label}: HTTP ${resp.status}`);
    const json = tryParseJson(await bodyText(resp));
    if (!json?.chart?.result?.[0]) throw new Error(`${label}: not chart JSON`);
    if (json.chart.error) throw new Error(`${label}: ${json.chart.error.description}`);
    return parseYahooChart(json, ticker);
  };

  // Helper: attempt Stooq through a CORS proxy
  const tryProxy = async (proxy) => {
    const resp = await fetchWithTimeout(proxy.buildUrl(stooqUrl));
    if (!resp.ok) throw new Error(`${proxy.name}: HTTP ${resp.status}`);
    let text = await bodyText(resp);
    if (proxy.envelope) text = unwrap(text);
    if (!text.trimStart().startsWith("Date"))
      throw new Error(`${proxy.name}: not CSV`);
    return parseStooqCsv(text, ticker);
  };

  // Race everything in parallel — first success wins
  const attempts = [
    tryYahoo(yahooQ1, "yahoo-q1"),
    tryYahoo(yahooQ2, "yahoo-q2"),
    // Stooq direct (works on localhost without CORS issues)
    fetchWithTimeout(stooqUrl, 8000).then(async (resp) => {
      if (!resp.ok) throw new Error(`stooq-direct: HTTP ${resp.status}`);
      const text = await bodyText(resp);
      if (!text.trimStart().startsWith("Date")) throw new Error("stooq-direct: not CSV");
      return parseStooqCsv(text, ticker);
    }),
    ...PROXIES.map(tryProxy),
  ];

  try {
    return await Promise.any(attempts);
  } catch (agg) {
    const details = (agg.errors ?? []).map((e) => `  • ${e.message}`).join("\n");
    throw new Error(
      `All data sources failed for "${ticker}".\n\n` +
      `To fix this, enter a free Alpha Vantage API key in the API Key field.\n` +
      `Get one in 60 seconds at: https://www.alphavantage.co/support/#api-key\n\n` +
      `Attempted sources:\n${details}`
    );
  }
}

// ─── main export ─────────────────────────────────────────

/**
 * Fetch stock data. Uses Alpha Vantage if apiKey is provided,
 * falls back to a parallel race of Yahoo direct + Stooq proxies.
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
      console.warn("Alpha Vantage failed, trying free fallback:", avErr.message);
    }
  }

  // Strategy 2: Yahoo direct + Stooq via proxies (parallel race)
  const result = await fetchFallback(ticker, startDate, endDate);
  _cache[key] = result;
  return result;
}
