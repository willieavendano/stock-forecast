import React from "react";

export default function DownloadButton({ data }) {
  const handleDownload = () => {
    if (!data) return;

    const rows = [["Date", "Model", "Point_Forecast", "Lower_5", "Upper_95"]];
    const { forecasts, bands, dates } = data;

    Object.entries(forecasts).forEach(([model, arr]) => {
      const b = bands?.[model];
      dates.forEach((d, i) => {
        rows.push([
          d,
          model,
          arr[i]?.toFixed(4) ?? "",
          b?.lower5?.[i]?.toFixed(4) ?? "",
          b?.upper95?.[i]?.toFixed(4) ?? "",
        ]);
      });
    });

    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `forecast_${data.ticker}_${dates[0]}_${dates[dates.length - 1]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <button className="btn btn-secondary" onClick={handleDownload}>
      Download Forecast CSV
    </button>
  );
}
