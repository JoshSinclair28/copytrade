import { useCallback, useEffect, useMemo, useState } from "react";
import Head from "next/head";
import Link from "next/link";

function fmtMoney(v) {
  const n = Number(v || 0);
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}
function toMs(ts) { if (typeof ts === "number") return ts < 1e12 ? ts * 1000 : ts; const p = new Date(ts).getTime(); return Number.isNaN(p) ? Date.now() : p; }
function ago(ts) { const m = Math.floor((Date.now() - toMs(ts)) / 60000); if (m < 1) return "now"; if (m < 60) return `${m}m ago`; const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`; return `${Math.floor(h / 24)}d ago`; }

export default function LivePicks() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [watchlist, setWatchlist] = useState([]);

  const load = useCallback(async () => {
    try {
      setLoading(true); setError(null);
      const winnersRes = await fetch("https://data-api.polymarket.com/v1/biggest-winners?timePeriod=month&limit=25&offset=0&category=overall");
      if (!winnersRes.ok) throw new Error(`Winners HTTP ${winnersRes.status}`);
      const winnersRaw = await winnersRes.json();
      const winners = (Array.isArray(winnersRaw) ? winnersRaw : winnersRaw?.data || []).filter((w) => w?.proxyWallet).slice(0, 15);

      const chunks = await Promise.all(winners.map(async (w) => {
        try {
          const r = await fetch(`https://data-api.polymarket.com/v1/activity?user=${encodeURIComponent(w.proxyWallet)}&limit=50`);
          if (!r.ok) return [];
          const raw = await r.json();
          const arr = Array.isArray(raw) ? raw : raw?.data || [];
          return arr.map((a, i) => ({
            id: `${w.proxyWallet}-${a.transactionHash || i}`,
            proxyWallet: w.proxyWallet,
            userName: a.name || w.userName || "Unknown Trader",
            profileImage: a.profileImage || w.profileImage || "",
            pnl: Number(w.pnl || 0),
            conditionId: a.conditionId || "",
            eventTitle: a.title || a.eventTitle || a.marketTitle || "Unknown market",
            side: (a.side || "").toString().toUpperCase(),
            outcome: (a.outcome || "").toString(),
            tradeType: (a.type || "TRADE").toString().toUpperCase(),
            amount: Number(a.usdcSize || a.amount || a.size || a.usdValue || 0),
            timestamp: a.timestamp || a.createdAt || a.updatedAt || Date.now(),
            eventSlug: a.eventSlug || a.slug || "",
          }));
        } catch { return []; }
      }));

      const grouped = new Map();
      chunks.flat().forEach((item) => {
        const key = [item.proxyWallet, item.conditionId, item.side, item.outcome, item.tradeType].join("|");
        const prev = grouped.get(key);
        if (!prev) {
          grouped.set(key, { ...item, txCount: 1, latestTs: toMs(item.timestamp) });
          return;
        }
        prev.amount += Number(item.amount || 0);
        prev.txCount += 1;
        const ts = toMs(item.timestamp);
        if (ts > prev.latestTs) {
          prev.latestTs = ts;
          prev.timestamp = item.timestamp;
          prev.eventTitle = item.eventTitle;
          prev.eventSlug = item.eventSlug;
          prev.profileImage = item.profileImage || prev.profileImage;
        }
      });

      setItems(Array.from(grouped.values()).sort((a, b) => b.latestTs - a.latestTs));
    } catch (e) {
      setError(e.message || "Failed to load activity");
      setItems([]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    try { setWatchlist(JSON.parse(localStorage.getItem("ct_watchlist") || "[]")); }
    catch { setWatchlist([]); }
  }, [load]);

  useEffect(() => {
    const id = setInterval(load, 120000);
    return () => clearInterval(id);
  }, [load]);

  const filtered = useMemo(() => items.filter((i) => {
    if (filter === "watched" && !watchlist.some((w) => w.proxyWallet === i.proxyWallet)) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!i.userName.toLowerCase().includes(q) && !i.eventTitle.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [items, filter, search, watchlist]);

  return (
    <>
      <Head>
        <title>Live Picks</title>
        <meta name="viewport" content="width=device-width,initial-scale=1" />
      </Head>
      <style>{`*{box-sizing:border-box}body{margin:0;background:#07070a;color:#eee;font-family:'Space Grotesk',sans-serif}.nav-link{padding:6px 12px;color:#777;text-decoration:none;border-radius:8px;font-weight:700}.nav-link.active{color:#fff;background:rgba(255,255,255,.08)}`}</style>
      <nav style={{ position: "sticky", top: 0, zIndex: 10, background: "rgba(7,7,10,.9)", borderBottom: "1px solid rgba(255,255,255,.07)", backdropFilter: "blur(10px)" }}><div style={{ maxWidth: 1000, margin: "0 auto", padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 }}><div style={{ width: 28, height: 28, borderRadius: 7, background: "linear-gradient(135deg,#F5C842,#F97316)", display: "grid", placeItems: "center", color: "#000", fontWeight: 900, fontFamily: "'Space Mono', monospace" }}>CT</div><div style={{ fontWeight: 800 }}>CopyTrade</div><Link href="/" className="nav-link">Dashboard</Link><Link href="/live" className="nav-link active">Live Picks</Link><button onClick={load} style={{ marginLeft: "auto", border: "1px solid rgba(255,255,255,.15)", background: "rgba(255,255,255,.04)", color: "#ccc", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontFamily: "'Space Mono', monospace" }}>Sync</button></div></nav>
      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "20px 16px 40px" }}>
        <h1 style={{ margin: 0, fontSize: 30, fontWeight: 900 }}>Live Picks Feed</h1>
        <p style={{ marginTop: 6, color: "#777" }}>Grouped recent activity from real Polymarket trader profiles.</p>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>{[{ id: "all", label: `All (${items.length})` }, { id: "watched", label: "Watched Traders" }].map((f) => <button key={f.id} onClick={() => setFilter(f.id)} style={{ border: "1px solid rgba(255,255,255,.15)", background: filter === f.id ? "rgba(245,200,66,.1)" : "rgba(255,255,255,.03)", color: filter === f.id ? "#F5C842" : "#bbb", borderRadius: 999, padding: "6px 12px", cursor: "pointer", fontSize: 12 }}>{f.label}</button>)}</div>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search username or market..." style={{ width: "100%", maxWidth: 320, marginBottom: 14, borderRadius: 10, border: "1px solid rgba(255,255,255,.12)", background: "rgba(255,255,255,.03)", color: "#efefef", padding: "9px 12px" }} />

        {loading && <div style={{ color: "#888" }}>Loading trader activity...</div>}
        {error && <div style={{ color: "#F87171" }}>{error}</div>}

        {!loading && !error && <div style={{ display: "grid", gap: 10 }}>{filtered.map((a) => <article key={a.id} style={{ border: "1px solid rgba(255,255,255,.08)", borderRadius: 12, padding: "12px 14px", background: "rgba(255,255,255,.015)" }}><div style={{ display: "flex", alignItems: "center", gap: 10 }}><div style={{ width: 34, height: 34, borderRadius: "50%", overflow: "hidden", background: "rgba(255,255,255,.06)", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 12 }}>{a.profileImage ? <img src={a.profileImage} alt={a.userName} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : a.userName.slice(0, 2).toUpperCase()}</div><div style={{ flex: 1 }}><div style={{ fontWeight: 700 }}>{a.userName}</div><div style={{ color: "#666", fontSize: 11, fontFamily: "'Space Mono', monospace" }}>{a.proxyWallet.slice(0, 8)}...{a.proxyWallet.slice(-6)}</div></div><div style={{ color: "#4ADE80", fontWeight: 700, fontFamily: "'Space Mono', monospace" }}>{fmtMoney(a.pnl)}</div></div><div style={{ marginTop: 10, color: "#d6d6d6", fontSize: 14 }}>{a.eventTitle}</div><div style={{ marginTop: 8, display: "flex", gap: 12, flexWrap: "wrap", color: "#808080", fontSize: 12 }}><span style={{ color: a.side.includes("BUY") ? "#4ADE80" : "#F87171", fontFamily: "'Space Mono', monospace" }}>{a.tradeType} · {a.side}{a.outcome ? ` (${a.outcome})` : ""}</span><span style={{ fontFamily: "'Space Mono', monospace" }}>Size: {fmtMoney(a.amount)}</span><span style={{ fontFamily: "'Space Mono', monospace" }}>Fills: {a.txCount}</span><span style={{ fontFamily: "'Space Mono', monospace" }}>{ago(a.timestamp)}</span>{a.eventSlug ? <a href={`https://polymarket.com/event/${a.eventSlug}`} target="_blank" rel="noreferrer" style={{ color: "#38BDF8", textDecoration: "none" }}>Open market</a> : null}</div></article>)}</div>}
      </main>
    </>
  );
}
