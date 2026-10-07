import React from "react";

const LABELS = {
  lstm: "LSTM",
  gbm: "GBM (Geometric Brownian Motion)",
  decision_tree: "Decision Tree",
  ensemble: "Ensemble",
  naive: "Naive (last price)",
};

const COLUMNS = ["MAE", "RMSE", "MAPE"];

export default function MetricsTable({ metrics, horizon }) {
  if (!metrics || Object.keys(metrics).length === 0) {
    return <p style={{ color: "var(--text-secondary)" }}>No metrics yet.</p>;
  }

  // Every model is scored on the same test days, so any row gives the counts
  const counts = Object.values(metrics)[0];
  const days = (v) => (v ? ` (${v.n} test days)` : "");

  const cells = (v, key) =>
    COLUMNS.map((c, i) => (
      <td key={`${key}-${c}`} className={i === 0 ? "group-start" : undefined}>
        {v ? v[c] : "—"}
      </td>
    ));

  return (
    <>
      <table className="metrics-table">
        <thead>
          <tr>
            <th rowSpan={2}>Model</th>
            <th colSpan={3} className="group">1 day ahead{days(counts.day1)}</th>
            <th colSpan={3} className="group">{horizon} days ahead{days(counts.dayH)}</th>
          </tr>
          <tr>
            {["day1", "dayH"].map((g) =>
              COLUMNS.map((c, i) => (
                <th key={`${g}-${c}`} className={i === 0 ? "group-start" : undefined}>
                  {c === "MAPE" ? "MAPE (%)" : c}
                </th>
              ))
            )}
          </tr>
        </thead>
        <tbody>
          {Object.entries(metrics).map(([m, v]) => (
            <tr key={m}>
              <td>
                <span className={`tag tag-${m === "decision_tree" ? "dt" : m}`}>
                  {LABELS[m] || m}
                </span>
              </td>
              {cells(v.day1, "day1")}
              {cells(v.dayH, "dayH")}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="metrics-note">
        Each test-set day is predicted from 1 and from {horizon} trading days
        earlier. The naive row carries the last known price forward unchanged —
        a model adds information only where its error is lower than that row.
      </p>
    </>
  );
}
