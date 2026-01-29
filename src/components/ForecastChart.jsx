import React, { useMemo } from "react";
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

const COLORS = {
  historical: "#78909c",
  lstm: "#42a5f5",
  gbm: "#ab47bc",
  decision_tree: "#66bb6a",
  ensemble: "#ff7043",
};

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="custom-tooltip">
      <p className="label">{label}</p>
      {payload.map((e, i) => (
        <p key={i} style={{ color: e.color, fontSize: "0.8rem" }}>
          {e.name}: ${Number(e.value).toFixed(2)}
        </p>
      ))}
    </div>
  );
}

export default function ForecastChart({ data }) {
  const chartData = useMemo(() => {
    if (!data) return [];
    const pts = [];

    // Historical
    data.historicalDates.forEach((d, i) => {
      pts.push({ date: d, historical: data.historicalPrices[i] });
    });

    // Forecasts
    const { forecasts, bands, dates } = data;
    dates.forEach((d, i) => {
      const pt = { date: d };
      Object.entries(forecasts).forEach(([m, arr]) => {
        pt[m] = arr[i];
      });
      // Bands
      Object.entries(bands || {}).forEach(([m, b]) => {
        if (b.lower5 && b.upper95) {
          pt[`${m}_band`] = [b.lower5[i], b.upper95[i]];
        }
      });
      pts.push(pt);
    });

    return pts;
  }, [data]);

  if (!chartData.length) return null;

  const modelKeys = Object.keys(data.forecasts);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2a2a4a" />
        <XAxis
          dataKey="date"
          tick={{ fill: "#a0a0b0", fontSize: 11 }}
          tickFormatter={(v) => v.slice(5)}
          interval="preserveStartEnd"
          minTickGap={40}
        />
        <YAxis
          tick={{ fill: "#a0a0b0", fontSize: 11 }}
          domain={["auto", "auto"]}
          tickFormatter={(v) => `$${Number(v).toFixed(0)}`}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend />

        <Line
          type="monotone" dataKey="historical" stroke={COLORS.historical}
          strokeWidth={2} dot={false} name="Historical" connectNulls={false}
        />

        {modelKeys.map((m) => (
          <React.Fragment key={m}>
            {data.bands?.[m] && (
              <Area
                type="monotone" dataKey={`${m}_band`}
                fill={COLORS[m] || "#888"} fillOpacity={0.15}
                stroke="none" name={`${m} 5–95%`} connectNulls={false}
              />
            )}
            <Line
              type="monotone" dataKey={m}
              stroke={COLORS[m] || "#888"} strokeWidth={2}
              strokeDasharray={m === "ensemble" ? "8 4" : undefined}
              dot={false} name={m.toUpperCase().replace("_", " ")}
              connectNulls={false}
            />
          </React.Fragment>
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
