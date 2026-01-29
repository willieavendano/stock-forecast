import React from "react";
import ForecastChart from "./ForecastChart.jsx";
import MetricsTable from "./MetricsTable.jsx";
import DownloadButton from "./DownloadButton.jsx";

export default function OutputPanel({ metrics, forecastResult }) {
  if (!metrics && !forecastResult) {
    return (
      <div className="card" style={{ textAlign: "center", padding: 60 }}>
        <h3 style={{ color: "var(--text-secondary)" }}>
          Select a ticker and click "Train &amp; Forecast" to begin
        </h3>
        <p style={{ color: "var(--text-secondary)", marginTop: 8, fontSize: "0.9rem" }}>
          All models run directly in your browser — no backend server needed.
        </p>
      </div>
    );
  }

  return (
    <div>
      {metrics && (
        <div className="card">
          <h3>Model Metrics — {metrics.ticker} (test set)</h3>
          <MetricsTable metrics={metrics.metrics} />
        </div>
      )}

      {forecastResult && (
        <div className="card">
          <h3>
            30-Day Forecast — {forecastResult.ticker}
            <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginLeft: 12 }}>
              {forecastResult.calendarSpan}
            </span>
          </h3>
          <div className="chart-container">
            <ForecastChart data={forecastResult} />
          </div>
        </div>
      )}

      {forecastResult && (
        <div className="card">
          <h3>Export</h3>
          <DownloadButton data={forecastResult} />
        </div>
      )}
    </div>
  );
}
