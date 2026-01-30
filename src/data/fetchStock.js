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

// ─── Yahoo Finance via CORS proxies (fallback) ──────────

const PROXIES = [
  {
    name: "corsproxy.io",
    buildUrl: (t) => `https://corsproxy.io/?url=${encodeURIComponent(t)}`,
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

async function fetchYahooViaProxies(ticker, startDate, endDate) {
  const p1 = Math.floor(new Date(startDate).getTime() / 1000);
  const p2 = Math.floor(new Date(endDate).getTime() / 1000);

  const v8 =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?period1=${p1}&period2=${p2}&interval=1d&includeAdjustedClose=true`;
  const v7 =
    `https://query1.finance.yahoo.com/v7/finance/download/${encodeURIComponent(ticker)}` +
    `?period1=${p1}&period2=${p2}&interval=1d&events=history&includeAdjustedClose=true`;

  const errors = [];

  // Try v8 JSON
  for (const proxy of PROXIES) {
    try {
      const resp = await fetch(proxy.buildUrl(v8));
      if (!resp.ok) { errors.push(`${proxy.name} v8: HTTP ${resp.status}`); continue; }
      let text = await bodyText(resp);
      if (proxy.envelope) text = unwrap(text);
      const json = tryParseJson(text);
      if (!json?.chart?.result?.[0]) { errors.push(`${proxy.name} v8: not Yahoo JSON`); continue; }
      if (json.chart.error) { errors.push(`${proxy.name} v8: ${json.chart.error.description}`); continue; }
      return parseYahooChart(json, ticker);
    } catch (e) { errors.push(`${proxy.name} v8: ${e.message}`); }
  }

  // Try v7 CSV
  for (const proxy of PROXIES) {
    try {
      const resp = await fetch(proxy.buildUrl(v7));
      if (!resp.ok) { errors.push(`${proxy.name} v7: HTTP ${resp.status}`); continue; }
      let text = await bodyText(resp);
      if (proxy.envelope) text = unwrap(text);
      if (!text.trimStart().startsWith("Date")) { errors.push(`${proxy.name} v7: not CSV`); continue; }
      return parseYahooCsv(text, ticker);
    } catch (e) { errors.push(`${proxy.name} v7: ${e.message}`); }
  }

  // Direct (localhost)
  for (const url of [v8, v7]) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) continue;
      const text = await bodyText(resp);
      const json = tryParseJson(text);
      if (json?.chart?.result?.[0]) return parseYahooChart(json, ticker);
      if (text.trimStart().startsWith("Date")) return parseYahooCsv(text, ticker);
    } catch { /* CORS */ }
  }

  throw new Error(
    `Yahoo fallback failed for "${ticker}". ${errors.length} attempts:\n` +
    errors.map((e) => `  - ${e}`).join("\n")
  );
}

// ─── parsers ─────────────────────────────────────────────

function parseYahooChart(json, ticker) {
  const chart = json.chart.result[0];
  const ts = chart.timestamp;
  const q = chart.indicators?.quote?.[0] || {};
  const adj = chart.indicators?.adjclose?.[0]?.adjclose;
  if (!ts || !q.close) throw new Error(`Incomplete Yahoo data for "${ticker}".`);

  const dates = [], prices = [], volumes = [], highs = [], lows = [], opens = [];
  for (let i = 0; i < ts.length; i++) {
    const p = adj?.[i] ?? q.close[i];
    if (p == null) continue;
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

function parseYahooCsv(csv, ticker) {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) throw new Error(`Empty CSV for "${ticker}".`);
  const hdr = lines[0].split(",").map((h) => h.trim());
  const ci = (n) => hdr.indexOf(n);
  const dateI = ci("Date");
  const priceI = ci("Adj Close") >= 0 ? ci("Adj Close") : ci("Close");
  if (dateI < 0 || priceI < 0) throw new Error(`Bad CSV columns for "${ticker}".`);

  const dates = [], prices = [], volumes = [], highs = [], lows = [], opens = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(",");
    const p = parseFloat(c[priceI]);
    if (isNaN(p) || !c[dateI] || c[dateI] === "null") continue;
    dates.push(c[dateI]);
    prices.push(p);
    volumes.push(parseInt(c[ci("Volume")], 10) || 0);
    highs.push(parseFloat(c[ci("High")]) || p);
    lows.push(parseFloat(c[ci("Low")]) || p);
    opens.push(parseFloat(c[ci("Open")]) || p);
  }
  if (!prices.length) throw new Error(`No valid CSV rows for "${ticker}".`);
  return { dates, prices, volumes, highs, lows, opens };
}

// ─── main export ─────────────────────────────────────────

/**
 * Fetch stock data. Uses Alpha Vantage if apiKey is provided,
 * falls back to Yahoo via CORS proxies.
 */
export async function fetchStockData(ticker, startDate, endDate, apiKey) {
  const key = cacheKey(ticker, startDate, endDate);
  if (_cache[key]) return _cache[key];

  // Strategy 1: Alpha Vantage (reliable, CORS-enabled)
  if (apiKey) {
    try {
      const result = await fetchAlphaVantage(ticker, startDate, endDate, apiKey);
      _cache[key] = result;
      return result;
    } catch (avErr) {
      // If AV fails (rate limit, bad key), fall through to Yahoo
      console.warn("Alpha Vantage failed, trying Yahoo fallback:", avErr.message);
    }
  }

  // Strategy 2: Yahoo Finance via CORS proxies
  const result = await fetchYahooViaProxies(ticker, startDate, endDate);
  _cache[key] = result;
  return result;
}
