import React, { useEffect, useRef } from "react";

export default function LogPanel({ logs }) {
  const endRef = useRef(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  return (
    <div className="card">
      <h3>Activity Log</h3>
      <div className="log-area">
        {logs.length === 0 && (
          <div className="log-entry" style={{ fontStyle: "italic" }}>
            Waiting for actions...
          </div>
        )}
        {logs.map((l, i) => (
          <div key={i} className={`log-entry ${l.level}`}>
            <span style={{ opacity: 0.5 }}>[{l.ts}]</span> {l.msg}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
