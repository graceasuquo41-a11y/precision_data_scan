import React, { useState, useCallback, useMemo } from "react";
import Papa from "papaparse";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell
} from "recharts";
import { Upload, TrendingUp, TrendingDown, AlertCircle, FileSpreadsheet, ChevronRight, Download } from "lucide-react";

const NAVY = "#0B1E3A";
const NAVY_DEEP = "#071527";
const GOLD = "#D4A64A";
const GOLD_SOFT = "#E8C97A";
const PAPER = "#F6F3EC";
const SLATE = "#6B7690";
const RUST = "#B3492B";
const SAGE = "#5C8368";

function detectColumnTypes(rows, fields) {
  const types = {};
  fields.forEach((f) => {
    let numeric = 0, date = 0, total = 0;
    rows.slice(0, 50).forEach((r) => {
      const v = r[f];
      if (v === undefined || v === null || v === "") return;
      total++;
      if (!isNaN(parseFloat(v)) && isFinite(v)) numeric++;
      else if (!isNaN(Date.parse(v))) date++;
    });
    if (total === 0) { types[f] = "empty"; return; }
    if (numeric / total > 0.8) types[f] = "numeric";
    else if (date / total > 0.6) types[f] = "date";
    else types[f] = "category";
  });
  return types;
}

function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (abs >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

export default function PrecisionDataScan() {
  const [rows, setRows] = useState(null);
  const [fields, setFields] = useState([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [currency, setCurrency] = useState("₦");
  const [businessName, setBusinessName] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const parseFile = useCallback((file) => {
    setError("");
    setIsLoading(true);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      worker: true,
      complete: (res) => {
        setIsLoading(false);
        if (!res.data || res.data.length === 0) {
          setError("That file came back empty. Check it has headers and at least one row of data.");
          return;
        }
        setRows(res.data);
        setFields(res.meta.fields || Object.keys(res.data[0]));
        setFileName(file.name);
      },
      error: () => {
        setIsLoading(false);
        setError("Couldn't read that file. Make sure it's a valid CSV.");
      },
    });
  }, []);

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) parseFile(f);
  };

  const analysis = useMemo(() => {
    if (!rows) return null;
    const types = detectColumnTypes(rows, fields);
    const numericCols = fields.filter((f) => types[f] === "numeric");
    const dateCol = fields.find((f) => types[f] === "date");
    const catCol = fields.find((f) => types[f] === "category");

    const numericStats = numericCols.map((col) => {
      const vals = rows.map((r) => parseFloat(r[col])).filter((v) => !isNaN(v));
      const sum = vals.reduce((a, b) => a + b, 0);
      const avg = sum / (vals.length || 1);
      const max = Math.max(...vals);
      const min = Math.min(...vals);
      return { col, sum, avg, max, min, count: vals.length };
    });

    let trend = null;
    if (dateCol && numericCols.length > 0) {
      const metric = numericCols[0];
      const byDate = {};
      rows.forEach((r) => {
        const d = r[dateCol];
        const v = parseFloat(r[metric]);
        if (!d || isNaN(v)) return;
        const key = new Date(d).toISOString().slice(0, 10);
        byDate[key] = (byDate[key] || 0) + v;
      });
      const sorted = Object.entries(byDate).sort(([a], [b]) => (a < b ? -1 : 1));
      if (sorted.length >= 2) {
        trend = { metric, data: sorted.map(([date, value]) => ({ date, value })) };
      }
    }

    let breakdown = null;
    if (catCol && numericCols.length > 0) {
      const metric = numericCols[0];
      const byCat = {};
      rows.forEach((r) => {
        const c = r[catCol] || "Unlabeled";
        const v = parseFloat(r[metric]);
        if (isNaN(v)) return;
        byCat[c] = (byCat[c] || 0) + v;
      });
      const sortedCats = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 8);
      breakdown = { metric, catCol, data: sortedCats.map(([name, value]) => ({ name, value })) };
    }

    const insights = [];
    if (numericStats[0]) {
      const s = numericStats[0];
      insights.push(`Total ${s.col}: ${currency}${fmt(s.sum)} across ${s.count} records.`);
      insights.push(`Average ${s.col} per record is ${currency}${fmt(s.avg)}.`);
    }
    if (trend && trend.data.length >= 2) {
      const first = trend.data[0].value;
      const last = trend.data[trend.data.length - 1].value;
      const pct = first !== 0 ? (((last - first) / Math.abs(first)) * 100).toFixed(0) : null;
      if (pct !== null) {
        insights.push(
          last >= first
            ? `${trend.metric} rose ${pct}% from the first to the last period in this data.`
            : `${trend.metric} fell ${Math.abs(pct)}% from the first to the last period in this data.`
        );
      }
    }
    if (breakdown && breakdown.data.length > 0) {
      const top = breakdown.data[0];
      const totalAll = breakdown.data.reduce((a, b) => a + b.value, 0);
      const share = totalAll ? ((top.value / totalAll) * 100).toFixed(0) : null;
      insights.push(`"${top.name}" leads ${breakdown.catCol} at ${currency}${fmt(top.value)}${share ? ` (${share}% of the top ${breakdown.data.length})` : ""}.`);
    }
    if (numericStats[0] && numericStats[0].max > numericStats[0].avg * 3) {
      insights.push(`There's an outlier in ${numericStats[0].col} — a value far above the average. Worth a manual check.`);
    }

    return { types, numericCols, numericStats, dateCol, catCol, trend, breakdown, insights, rowCount: rows.length };
  }, [rows, fields, currency]);

  const reset = () => { setRows(null); setFields([]); setFileName(""); setError(""); };

  return (
    <div style={{ minHeight: "100vh", background: PAPER, fontFamily: "'Inter', -apple-system, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; }
        .fraunces { font-family: 'Fraunces', serif; }
        .mono { font-family: 'Space Mono', monospace; }
        ::selection { background: ${GOLD_SOFT}; }
        button:focus-visible, input:focus-visible { outline: 2px solid ${GOLD}; outline-offset: 2px; }

        @media print {
          .no-print { display: none !important; }
          body, html { background: #fff !important; }
          .print-report { display: block !important; }
          .app-shell { display: none !important; }
        }
        .print-report { display: none; }
      `}</style>

      <div className="app-shell">
      {/* Header */}
      <header style={{ background: NAVY, color: PAPER, padding: "28px 24px" }}>
        <div style={{ maxWidth: 980, margin: "0 auto", display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div className="mono" style={{ fontSize: 11, letterSpacing: "0.14em", color: GOLD, marginBottom: 6 }}>PRECISION DATA ANALYTICS</div>
            <h1 className="fraunces" style={{ fontSize: 30, fontWeight: 600, margin: 0 }}>Data Scan</h1>
          </div>
          <div style={{ fontSize: 13, color: SLATE, maxWidth: 320, textAlign: "right" }}>
            Drop a spreadsheet in. Get the story behind the numbers, no formulas required.
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 980, margin: "0 auto", padding: "32px 24px 64px" }}>
        {isLoading && (
          <div style={{ textAlign: "center", padding: "80px 24px" }}>
            <div style={{
              width: 36, height: 36, margin: "0 auto 20px", borderRadius: "50%",
              border: `3px solid #E5E0D2`, borderTopColor: GOLD,
              animation: "spin 0.8s linear infinite"
            }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            <div className="fraunces" style={{ fontSize: 17, color: NAVY }}>Reading your file...</div>
            <div style={{ fontSize: 13, color: SLATE, marginTop: 6 }}>Large files can take a few seconds.</div>
          </div>
        )}
        {!rows && !isLoading && (
          <div>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              style={{
                border: `2px dashed ${dragOver ? GOLD : "#C9C2AE"}`,
                borderRadius: 4,
                background: dragOver ? "#FBF6E9" : "#FFFFFF",
                padding: "64px 24px",
                textAlign: "center",
                transition: "all 0.15s ease",
              }}
            >
              <Upload size={28} color={dragOver ? GOLD : SLATE} style={{ marginBottom: 16 }} />
              <div className="fraunces" style={{ fontSize: 20, color: NAVY, marginBottom: 8 }}>
                Drag a CSV file here
              </div>
              <div style={{ fontSize: 14, color: SLATE, marginBottom: 20 }}>
                Sales records, expenses, orders, leads — any spreadsheet with rows and columns.
              </div>
              <label style={{
                display: "inline-block", background: NAVY, color: PAPER, padding: "10px 22px",
                borderRadius: 3, fontSize: 14, fontWeight: 600, cursor: "pointer", letterSpacing: "0.01em"
              }}>
                Choose file
                <input type="file" accept=".csv" style={{ display: "none" }}
                  onChange={(e) => e.target.files?.[0] && parseFile(e.target.files[0])} />
              </label>
            </div>
            {error && (
              <div style={{ marginTop: 16, padding: "12px 16px", background: "#FBEAE4", borderLeft: `3px solid ${RUST}`, color: RUST, fontSize: 14, borderRadius: 2 }}>
                <AlertCircle size={14} style={{ verticalAlign: "-2px", marginRight: 8 }} />
                {error}
              </div>
            )}
            <div style={{ marginTop: 32, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
              {[
                ["Trends", "Spots rising or falling numbers over time automatically."],
                ["Top performers", "Ranks your categories, products, or channels by value."],
                ["Plain-English insights", "No jargon. Just what the data is telling you."],
              ].map(([title, desc]) => (
                <div key={title} style={{ background: "#fff", padding: 18, borderRadius: 3, border: "1px solid #E5E0D2" }}>
                  <div className="fraunces" style={{ fontSize: 15, fontWeight: 600, color: NAVY, marginBottom: 4 }}>{title}</div>
                  <div style={{ fontSize: 13, color: SLATE, lineHeight: 1.5 }}>{desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {rows && analysis && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, flexWrap: "wrap", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <FileSpreadsheet size={16} color={SLATE} />
                <span style={{ fontSize: 13, color: SLATE }}>{fileName} · {analysis.rowCount} rows</span>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="Client / business name"
                  style={{ fontSize: 13, border: "1px solid #D9D2BE", borderRadius: 3, padding: "6px 10px", background: "#fff", color: NAVY, width: 170 }}
                />
                <select value={currency} onChange={(e) => setCurrency(e.target.value)}
                  style={{ fontSize: 13, border: "1px solid #D9D2BE", borderRadius: 3, padding: "6px 10px", background: "#fff", color: NAVY }}>
                  <option value="₦">₦ Naira</option>
                  <option value="$">$ Dollar</option>
                  <option value="£">£ Pound</option>
                  <option value="€">€ Euro</option>
                  <option value="">No symbol</option>
                </select>
                <button onClick={() => window.print()} style={{
                  fontSize: 13, color: NAVY_DEEP, background: GOLD, border: "none",
                  borderRadius: 3, padding: "6px 14px", cursor: "pointer", fontWeight: 600,
                  display: "flex", alignItems: "center", gap: 6
                }}>
                  <Download size={13} /> Download report
                </button>
                <button onClick={reset} style={{
                  fontSize: 13, color: NAVY, background: "none", border: `1px solid ${NAVY}`,
                  borderRadius: 3, padding: "6px 14px", cursor: "pointer", fontWeight: 500
                }}>
                  Scan another file
                </button>
              </div>
            </div>

            {/* Insight ticker — signature element */}
            <div style={{
              background: NAVY_DEEP, borderRadius: 4, padding: "16px 20px", marginBottom: 28,
              display: "flex", flexDirection: "column", gap: 10
            }}>
              <div className="mono" style={{ fontSize: 10, letterSpacing: "0.14em", color: GOLD, marginBottom: 2 }}>
                WHAT THIS DATA IS TELLING YOU
              </div>
              {analysis.insights.length === 0 && (
                <div style={{ color: SLATE, fontSize: 14 }}>Not enough structure in this file to generate insights yet.</div>
              )}
              {analysis.insights.map((line, i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <ChevronRight size={14} color={GOLD} style={{ marginTop: 3, flexShrink: 0 }} />
                  <span style={{ color: PAPER, fontSize: 14.5, lineHeight: 1.5 }}>{line}</span>
                </div>
              ))}
            </div>

            {/* KPI cards */}
            {analysis.numericStats.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 28 }}>
                {analysis.numericStats.slice(0, 4).map((s) => (
                  <div key={s.col} style={{ background: "#fff", border: "1px solid #E5E0D2", borderRadius: 4, padding: 16 }}>
                    <div style={{ fontSize: 12, color: SLATE, marginBottom: 6, textTransform: "capitalize" }}>{s.col}</div>
                    <div className="fraunces" style={{ fontSize: 24, color: NAVY, fontWeight: 600 }}>{currency}{fmt(s.sum)}</div>
                    <div style={{ fontSize: 11.5, color: SLATE, marginTop: 4 }}>avg {currency}{fmt(s.avg)} · max {currency}{fmt(s.max)}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Trend chart */}
            {analysis.trend && (
              <div style={{ background: "#fff", border: "1px solid #E5E0D2", borderRadius: 4, padding: "20px 20px 8px", marginBottom: 24 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  {analysis.trend.data[analysis.trend.data.length - 1].value >= analysis.trend.data[0].value
                    ? <TrendingUp size={15} color={SAGE} /> : <TrendingDown size={15} color={RUST} />}
                  <span className="fraunces" style={{ fontSize: 16, color: NAVY, fontWeight: 600 }}>
                    {analysis.trend.metric} over time
                  </span>
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={analysis.trend.data}>
                    <CartesianGrid stroke="#EFEADE" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: SLATE }} axisLine={{ stroke: "#E5E0D2" }} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: SLATE }} axisLine={false} tickLine={false} tickFormatter={fmt} />
                    <Tooltip formatter={(v) => `${currency}${fmt(v)}`} contentStyle={{ fontSize: 12, borderRadius: 4, border: "1px solid #E5E0D2" }} />
                    <Line type="monotone" dataKey="value" stroke={GOLD} strokeWidth={2.5} dot={{ r: 3, fill: NAVY }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Breakdown chart */}
            {analysis.breakdown && (
              <div style={{ background: "#fff", border: "1px solid #E5E0D2", borderRadius: 4, padding: "20px 20px 8px", marginBottom: 24 }}>
                <div className="fraunces" style={{ fontSize: 16, color: NAVY, fontWeight: 600, marginBottom: 12 }}>
                  {analysis.breakdown.metric} by {analysis.breakdown.catCol}
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={analysis.breakdown.data} layout="vertical" margin={{ left: 8 }}>
                    <CartesianGrid stroke="#EFEADE" strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: SLATE }} axisLine={false} tickLine={false} tickFormatter={fmt} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11.5, fill: NAVY }} width={110} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(v) => `${currency}${fmt(v)}`} contentStyle={{ fontSize: 12, borderRadius: 4, border: "1px solid #E5E0D2" }} />
                    <Bar dataKey="value" radius={[0, 3, 3, 0]}>
                      {analysis.breakdown.data.map((_, i) => (
                        <Cell key={i} fill={i === 0 ? GOLD : "#C9BE9A"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            <div style={{ fontSize: 12, color: SLATE, textAlign: "center", marginTop: 8 }}>
              All processing happens in your browser — the file never leaves this page.
            </div>
          </div>
        )}
      </main>
      </div>

      {/* Printable one-pager, only visible when printing */}
      {analysis && (
        <div className="print-report" style={{ padding: "36px 40px", color: NAVY_DEEP, fontFamily: "'Inter', sans-serif" }}>
          <div style={{ borderBottom: `3px solid ${GOLD}`, paddingBottom: 16, marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
            <div>
              <div className="mono" style={{ fontSize: 10, letterSpacing: "0.14em", color: NAVY, marginBottom: 6 }}>PRECISION DATA ANALYTICS · ASUQUO GROUP</div>
              <div className="fraunces" style={{ fontSize: 26, fontWeight: 700 }}>Data Scan Report</div>
            </div>
            <div style={{ textAlign: "right", fontSize: 12, color: SLATE }}>
              {businessName && <div style={{ fontWeight: 600, color: NAVY_DEEP, fontSize: 14 }}>{businessName}</div>}
              <div>{new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</div>
              <div>{fileName} · {analysis.rowCount} records</div>
            </div>
          </div>

          <div className="fraunces" style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.04em", color: NAVY }}>
            Key figures
          </div>
          <div style={{ display: "flex", gap: 24, marginBottom: 24, flexWrap: "wrap" }}>
            {analysis.numericStats.slice(0, 4).map((s) => (
              <div key={s.col} style={{ minWidth: 140 }}>
                <div style={{ fontSize: 11, color: SLATE, textTransform: "capitalize" }}>{s.col}</div>
                <div className="fraunces" style={{ fontSize: 20, fontWeight: 700 }}>{currency}{fmt(s.sum)}</div>
                <div style={{ fontSize: 10.5, color: SLATE }}>avg {currency}{fmt(s.avg)} · max {currency}{fmt(s.max)}</div>
              </div>
            ))}
          </div>

          <div className="fraunces" style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.04em", color: NAVY }}>
            What the data shows
          </div>
          <ul style={{ margin: "0 0 24px", paddingLeft: 18, fontSize: 13, lineHeight: 1.9 }}>
            {analysis.insights.map((line, i) => <li key={i}>{line}</li>)}
          </ul>

          {analysis.breakdown && (
            <>
              <div className="fraunces" style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.04em", color: NAVY }}>
                {analysis.breakdown.metric} by {analysis.breakdown.catCol}
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, marginBottom: 24 }}>
                <thead>
                  <tr style={{ borderBottom: `1.5px solid ${NAVY}` }}>
                    <th style={{ textAlign: "left", padding: "6px 4px", color: SLATE, fontWeight: 600 }}>{analysis.breakdown.catCol}</th>
                    <th style={{ textAlign: "right", padding: "6px 4px", color: SLATE, fontWeight: 600 }}>{analysis.breakdown.metric}</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.breakdown.data.map((row) => (
                    <tr key={row.name} style={{ borderBottom: "1px solid #E5E0D2" }}>
                      <td style={{ padding: "6px 4px" }}>{row.name}</td>
                      <td style={{ padding: "6px 4px", textAlign: "right" }}>{currency}{fmt(row.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <div style={{ borderTop: "1px solid #E5E0D2", paddingTop: 14, marginTop: 12, fontSize: 11, color: SLATE, display: "flex", justifyContent: "space-between" }}>
            <span>Prepared by Precision Data Analytics — a Asuquo Group company</span>
            <span>Port Harcourt, Nigeria</span>
          </div>
        </div>
      )}
    </div>
  );
}
