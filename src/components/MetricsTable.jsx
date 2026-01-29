import React from "react";

const LABELS = {
  lstm: "LSTM",
  gbm: "GBM (Geometric Brownian Motion)",
  decision_tree: "Decision Tree",
};

export default function MetricsTable({ metrics }) {
  if (!metrics || Object.keys(metrics).length === 0) {
    return <p style={{ color: "var(--text-secondary)" }}>No metrics yet.</p>;
  }

  return (
    <table className="metrics-table">
      <thead>
        <tr>
          <th>Model</th>
          <th>MAE</th>
          <th>RMSE</th>
          <th>MAPE (%)</th>
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
            <td>{v.MAE}</td>
            <td>{v.RMSE}</td>
            <td>{v.MAPE}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
