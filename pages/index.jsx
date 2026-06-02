import { useCallback, useEffect, useMemo, useState } from "react";
import Head from "next/head";
import Link from "next/link";

const TIERS = [
  { id: "elite", label: "ELITE", min: 50000, color: "#F5C842", desc: "$50k+ PnL" },
  { id: "pro", label: "PRO", min: 10000, color: "#38BDF8", desc: "$10k-$50k PnL" },
  { id: "solid", label: "SOLID", min: 2000, color: "#4ADE80", desc: "$2k-$10k PnL" },
  { id: "rising", label: "RISING", min: 0, color: "#C084FC", desc: "Under $2k PnL" },
];

function fmtMoney(v) {
  const n = Number(v || 0);
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}
function fmtPct(v) { return `${Number(v || 0).toFixed(1)}%`; }
function calcRoi(pnl, initialValue) {
  const i = Number(initialValue || 0);
  if (i <= 0) return 0;
  return Math.max(-999, Math.min(999, (Number(pnl || 0) / i) * 100));
}
function estimateWinRate(roi) {
  if (roi > 100) return 75;
  if (roi > 50) return 65;
  if (roi > 20) return 58;
  return 52;
}
function tailScore(t) {
  const pnlScore = Math.min(45, Math.log10(Math.max(1, t.pnl || 0)) * 12);
  const roiScore = Math.min(35, Math.max(0, t.roi || 0) * 0.35);
  const breadthScore = Math.min(20, (t.tradeCount || 0) * 2);
  return Math.max(0, Math.min(100, Math.round(pnlScore + roiScore + breadthScore)));
}
function tierForPnl(pnl) {
  if (pnl >= 50000) return TIERS[0];
  if (pnl >= 10000) return TIERS[1];
  if (pnl >= 2000) return TIERS[2];
  return TIERS[3];
}

export default function Home() {
  const [traders, setTraders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("leaderboard");
  const [search, setSearch] = useState("");
  const [watchlist, setWatchlist] = useState([]);

  const fetchTraders = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("https://data-api.polymarket.com/v1/biggest-winners?timePeriod=month&limit=100&offset=0&category=overall");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json();
      const arr = Array.isArray(raw) ? raw : raw?.data || [];

      const byWallet = new Map();
      arr.forEach((t, i) => {
        const wallet = t.proxyWallet || `wallet_${i}`;
        const pnl = Number(t.pnl || 0);
        const initialValue = Number(t.initialValue || 0);
        const cur = byWallet.get(wallet) || {
          id: wallet,
          userName: t.userName || "Unknown Trader",
          proxyWallet: wallet,
          pnl: 0,
          initialValue: 0,
          finalValue: 0,
          tradeCount: 0,
          topEventTitle: "",
          topEventPnl: -Infinity,
        };
        cur.pnl += pnl;
        cur.initialValue += initialValue;
        cur.finalValue += Number(t.finalValue || 0);
        cur.tradeCount += 1;
        if (pnl > cur.topEventPnl) {
          cur.topEventPnl = pnl;
          cur.topEventTitle = t.eventTitle || "";
        }
        byWallet.set(wallet, cur);
      });

      const data = Array.from(byWallet.values()).map((t) => {
        const roi = calcRoi(t.pnl, t.initialValue);
        return { ...t, roi, estWin: estimateWinRate(roi), eventTitle: t.topEventTitle };
      }).sort((a, b) => b.pnl - a.pnl);

      setTraders(data);
    } catch (e) {
      setError(e.message || "Failed to load leaderboard");
      setTraders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTraders();
    try { setWatchlist(JSON.parse(localStorage.getItem("ct_watchlist") || "[]")); }
    catch { setWatchlist([]); }
  }, [fetchTraders]);

  const toggleWatch = useCallback((trader) => {
    setWatchlist((prev) => {
      const has = prev.some((w) => w.proxyWallet === trader.proxyWallet);
      const next = has ? prev.filter((w) => w.proxyWallet !== trader.proxyWallet) : [...prev, trader];
      localStorage.setItem("ct_watchlist", JSON.stringify(next));
      return next;
    });
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return traders;
    return traders.filter((t) => t.userName.toLowerCase().includes(q) || t.proxyWallet.toLowerCase().includes(q));
  }, [search, traders]);

  const groupedByTier = useMemo(() => TIERS.map((tier) => ({
    tier,
    traders: filtered.filter((t) => {
      if (tier.id === "elite") return t.pnl >= 50000;
      if (tier.id === "pro") return t.pnl >= 10000 && t.pnl < 50000;
      if (tier.id === "solid") return t.pnl >= 2000 && t.pnl < 10000;
      return t.pnl < 2000;
    }),
  })), [filtered]);

  const tail = useMemo(() => [...filtered].sort((a, b) => tailScore(b) - tailScore(a)), [filtered]);
  const totalProfit = useMemo(() => filtered.reduce((s, t) => s + t.pnl, 0), [filtered]);
  const avgEstWin = useMemo(() => (filtered.length ? filtered.reduce((s, t) => s + t.estWin, 0) / filtered.length : 0), [filtered]);

  return (
    <>
      <Head>
        <title>CopyTrade Dashboard</title>
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Space+Grotesk:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </Head>
      <style>{`*{box-sizing:border-box}body{margin:0;background:#07070a;color:#eee;font-family:'Space Grotesk',sans-serif}.nav-link{padding:6px 12px;color:#777;text-decoration:none;border-radius:8px;font-weight:700}.nav-link.active{color:#fff;background:rgba(255,255,255,.08)}.stats-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}@media (max-width:900px){.stats-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}`}</style>

      <nav style={{ position: "sticky", top: 0, zIndex: 10, background: "rgba(7,7,10,.9)", borderBottom: "1px solid rgba(255,255,255,.07)", backdropFilter: "blur(10px)" }}>
        <div style={{ maxWidth: 1140, margin: "0 auto", padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: "linear-gradient(135deg,#F5C842,#F97316)", display: "grid", placeItems: "center", color: "#000", fontWeight: 900, fontFamily: "'Space Mono', monospace" }}>CT</div>
          <div style={{ fontWeight: 800 }}>CopyTrade</div>
          <Link href="/" className="nav-link active">Dashboard</Link>
          <Link href="/live" className="nav-link">Live Picks</Link>
          <button onClick={fetchTraders} style={{ marginLeft: "auto", border: "1px solid rgba(255,255,255,.15)", background: "rgba(255,255,255,.04)", color: "#ccc", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontFamily: "'Space Mono', monospace" }}>Sync</button>
        </div>
      </nav>

      <main style={{ maxWidth: 1140, margin: "0 auto", padding: "20px 16px 40px" }}>
        <div className="stats-grid" style={{ marginBottom: 14 }}>
          <div style={{ border: "1px solid rgba(255,255,255,.08)", background: "rgba(255,255,255,.02)", borderRadius: 12, padding: "14px 16px" }}><div style={{ color: "#787878", fontSize: 10, letterSpacing: ".08em", fontWeight: 700 }}>TRADERS TRACKED</div><div style={{ fontSize: 26, fontWeight: 800, fontFamily: "'Space Mono', monospace" }}>{traders.length}</div></div>
          <div style={{ border: "1px solid rgba(255,255,255,.08)", background: "rgba(255,255,255,.02)", borderRadius: 12, padding: "14px 16px" }}><div style={{ color: "#787878", fontSize: 10, letterSpacing: ".08em", fontWeight: 700 }}>YOU'RE TAILING</div><div style={{ fontSize: 26, fontWeight: 800, color: "#4ADE80", fontFamily: "'Space Mono', monospace" }}>{watchlist.length}</div></div>
          <div style={{ border: "1px solid rgba(255,255,255,.08)", background: "rgba(255,255,255,.02)", borderRadius: 12, padding: "14px 16px" }}><div style={{ color: "#787878", fontSize: 10, letterSpacing: ".08em", fontWeight: 700 }}>POOL PROFIT</div><div style={{ fontSize: 26, fontWeight: 800, color: "#F5C842", fontFamily: "'Space Mono', monospace" }}>{fmtMoney(totalProfit)}</div></div>
          <div style={{ border: "1px solid rgba(255,255,255,.08)", background: "rgba(255,255,255,.02)", borderRadius: 12, padding: "14px 16px" }}><div style={{ color: "#787878", fontSize: 10, letterSpacing: ".08em", fontWeight: 700 }}>AVG WIN RATE</div><div style={{ fontSize: 26, fontWeight: 800, color: "#38BDF8", fontFamily: "'Space Mono', monospace" }}>{fmtPct(avgEstWin)}</div></div>
        </div>

        <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>{["leaderboard", "tail"].map((k) => <button key={k} onClick={() => setTab(k)} style={{ background: "none", border: "none", borderBottom: tab === k ? "2px solid #F5C842" : "2px solid transparent", color: tab === k ? "#F5C842" : "#777", fontWeight: 700, cursor: "pointer", padding: "8px 2px" }}>{k === "leaderboard" ? "Leaderboard" : "Who To Tail"}</button>)}</div>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search username or wallet..." style={{ width: "100%", maxWidth: 320, marginBottom: 14, borderRadius: 10, border: "1px solid rgba(255,255,255,.12)", background: "rgba(255,255,255,.03)", color: "#efefef", padding: "9px 12px" }} />

        {loading && <div style={{ color: "#888" }}>Loading real Polymarket data...</div>}
        {error && <div style={{ color: "#F87171" }}>{error}</div>}

        {!loading && !error && tab === "leaderboard" && groupedByTier.map(({ tier, traders: list }) => (
          <section key={tier.id} style={{ border: "1px solid rgba(255,255,255,.08)", borderRadius: 12, overflow: "hidden", marginBottom: 12 }}>
            <div style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,.07)", display: "flex", alignItems: "center", gap: 8 }}><div style={{ width: 8, height: 8, borderRadius: 999, background: tier.color }} /><strong style={{ color: tier.color, fontSize: 12, letterSpacing: ".08em" }}>{tier.label}</strong><span style={{ color: "#777", fontSize: 12 }}>{tier.desc}</span></div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr style={{ color: "#666", fontSize: 11 }}>{["Rank", "Name", "Volume", "ROI%", "EST. WIN", "Net Profit", "Watch"].map((h) => <th key={h} style={{ textAlign: h === "Name" ? "left" : "right", padding: "8px 10px" }}>{h}</th>)}</tr></thead><tbody>{list.map((t, i) => { const watched = watchlist.some((w) => w.proxyWallet === t.proxyWallet); return <tr key={t.id} style={{ borderTop: "1px solid rgba(255,255,255,.05)" }}><td style={{ padding: "9px 10px", textAlign: "right", color: "#777", fontFamily: "'Space Mono', monospace" }}>{i + 1}</td><td style={{ padding: "9px 10px" }}><div style={{ fontWeight: 700 }}>{t.userName}</div><div style={{ color: "#666", fontSize: 11, fontFamily: "'Space Mono', monospace" }}>{t.proxyWallet.slice(0, 8)}...{t.proxyWallet.slice(-6)}</div></td><td style={{ padding: "9px 10px", textAlign: "right", color: "#a0a0a0", fontFamily: "'Space Mono', monospace" }}>{fmtMoney(t.initialValue)}</td><td style={{ padding: "9px 10px", textAlign: "right", color: t.roi >= 0 ? "#4ADE80" : "#F87171", fontFamily: "'Space Mono', monospace" }}>{fmtPct(t.roi)}</td><td style={{ padding: "9px 10px", textAlign: "right", color: "#38BDF8", fontFamily: "'Space Mono', monospace" }}>{fmtPct(t.estWin)}</td><td style={{ padding: "9px 10px", textAlign: "right", color: t.pnl >= 0 ? "#4ADE80" : "#F87171", fontWeight: 700, fontFamily: "'Space Mono', monospace" }}>{fmtMoney(t.pnl)}</td><td style={{ padding: "9px 10px", textAlign: "right" }}><button onClick={() => toggleWatch(t)} style={{ border: `1px solid ${watched ? "#4ADE80" : "rgba(255,255,255,.2)"}`, background: watched ? "rgba(74,222,128,.12)" : "rgba(255,255,255,.03)", color: watched ? "#4ADE80" : "#bbb", borderRadius: 999, padding: "4px 10px", fontSize: 11, cursor: "pointer" }}>{watched ? "Watching" : "Watch"}</button></td></tr>; })}</tbody></table>
          </section>
        ))}

        {!loading && !error && tab === "tail" && <div style={{ display: "grid", gap: 10 }}>{tail.map((t, i) => { const watched = watchlist.some((w) => w.proxyWallet === t.proxyWallet); const tier = tierForPnl(t.pnl); return <div key={t.id} style={{ border: "1px solid rgba(255,255,255,.08)", borderRadius: 12, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, background: "rgba(255,255,255,.015)" }}><div style={{ width: 28, textAlign: "right", color: "#707070", fontFamily: "'Space Mono', monospace" }}>#{i + 1}</div><div style={{ flex: 1 }}><div style={{ fontWeight: 700 }}>{t.userName}</div><div style={{ color: "#767676", fontSize: 12 }}>{tier.label} · {fmtMoney(t.pnl)} pnl · {fmtPct(t.roi)} ROI · EST. WIN {fmtPct(t.estWin)} · {t.tradeCount} trades</div></div><div style={{ minWidth: 55, textAlign: "center" }}><div style={{ color: "#F5C842", fontWeight: 800, fontFamily: "'Space Mono', monospace" }}>{tailScore(t)}</div></div><button onClick={() => toggleWatch(t)} style={{ border: `1px solid ${watched ? "#4ADE80" : "rgba(255,255,255,.2)"}`, background: watched ? "rgba(74,222,128,.12)" : "rgba(255,255,255,.03)", color: watched ? "#4ADE80" : "#bbb", borderRadius: 999, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>{watched ? "Watching" : "Watch"}</button></div>; })}</div>}
      </main>
    </>
  );
}
