/**
 * Parsers that turn each data source's response into one shape:
 *   { dates, prices, volumes, highs, lows, opens } — oldest bar first.
 *
 * No imports and no browser APIs: shared by the client fetcher and the
 * /api/prices server function.
 */

export function parseYahooChart(json, ticker) {
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

export function parseStooqCsv(csv, ticker) {
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

  if (dates.length > 1 && dates[0] > dates[dates.length - 1]) {
    dates.reverse(); prices.reverse(); volumes.reverse();
    highs.reverse(); lows.reverse(); opens.reverse();
  }
  return { dates, prices, volumes, highs, lows, opens };
}

export function parseNasdaqJson(json, ticker) {
  const rows = json?.data?.tradesTable?.rows;
  if (!rows?.length) throw new Error(`No NASDAQ rows for "${ticker}".`);

  const clean = (s) => parseFloat((s ?? "").replace(/[$,]/g, ""));
  const cleanVol = (s) => parseInt((s ?? "").replace(/,/g, ""), 10) || 0;

  // MM/DD/YYYY → YYYY-MM-DD
  const fmtDate = (s) => {
    const p = (s ?? "").split("/");
    return p.length === 3
      ? `${p[2]}-${p[0].padStart(2, "0")}-${p[1].padStart(2, "0")}`
      : null;
  };

  const dates = [], prices = [], volumes = [], highs = [], lows = [], opens = [];
  for (const row of rows) {
    const date = fmtDate(row.date);
    const p = clean(row.close);
    if (!date || isNaN(p)) continue;
    dates.push(date);
    prices.push(p);
    volumes.push(cleanVol(row.volume));
    highs.push(clean(row.high) || p);
    lows.push(clean(row.low) || p);
    opens.push(clean(row.open) || p);
  }
  if (!prices.length) throw new Error(`No valid NASDAQ rows for "${ticker}".`);

  // NASDAQ returns newest-first
  if (dates.length > 1 && dates[0] > dates[dates.length - 1]) {
    dates.reverse(); prices.reverse(); volumes.reverse();
    highs.reverse(); lows.reverse(); opens.reverse();
  }
  return { dates, prices, volumes, highs, lows, opens };
}
