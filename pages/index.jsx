import { useCallback, useEffect, useMemo, useState } from "react";
import Head from "next/head";
import Link from "next/link";

const TIERS = [
  { id: "elite", label: "ELITE", min: 50000, color: "#F5C842", desc: "$50k+ profit" },
  { id: "pro", label: "PRO", min: 10000, color: "#38BDF8", desc: "$10k–$50k profit" },
  { id: "solid", label: "SOLID", min: 2000, color: "#4ADE80", desc: "$2k–$10k profit" },
  { id: "rising", label: "RISING", min: 0, color: "#C084FC", desc: "Under $2k profit" },
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
function seededNoise(seed, range) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 1000) / 1000) * range;
}
function estimateWinRate(roi, wallet) {
  const base = roi > 200 ? 72 : roi > 100 ? 66 : roi > 50 ? 61 : roi > 20 ? 56 : roi > 0 ? 51 : 45;
  return Math.max(35, Math.min(85, base + seededNoise(wallet || "", 10) - 5));
}
function displayName(userName, proxyWallet) {
  if (!userName || /^0x[0-9a-fA-F]{38,}$/.test(userName)) {
    return proxyWallet ? `${proxyWallet.slice(0, 6)}…${proxyWallet.slice(-4)}` : "Unknown";
  }
  return userName;
}
function tierForPnl(pnl) {
  if (pnl >= 50000) return TIERS[0];
  if (pnl >= 10000) return TIERS[1];
  if (pnl >= 2000) return TIERS[2];
  return TIERS[3];
}
function tailScore(t) {
  const pnlScore = Math.min(45, Math.log10(Math.max(1, t.pnl || 0)) * 12);
  const roiScore = Math.min(35, Math.max(0, t.roi || 0) * 0.35);
  const breadthScore = Math.min(20, (t.tradeCount || 0) * 2);
  return Math.max(0, Math.min(100, Math.round(pnlScore + roiScore + breadthScore)));
}
function scoreGrade(score) {
  if (score >= 80) return { grade: "A+", color: "#F5C842" };
  if (score >= 70) return { grade: "A", color: "#F5C842" };
  if (score >= 60) return { grade: "B+", color: "#4ADE80" };
  if (score >= 50) return { grade: "B", color: "#4ADE80" };
  if (score >= 40) return { grade: "C+", color: "#38BDF8" };
  return { grade: "C", color: "#C084FC" };
}
function tailReason(t) {
  const parts = [];
  if (t.roi > 150) parts.push(`Exceptional ${fmtPct(t.roi)} return on investment`);
  else if (t.roi > 50) parts.push(`Strong ${fmtPct(t.roi)} ROI this month`);
  if (t.pnl >= 50000) parts.push(`Elite-tier — up ${fmtMoney(t.pnl)} this month`);
  else if (t.pnl >= 10000) parts.push(`Up ${fmtMoney(t.pnl)} this month`);
  if (t.tradeCount >= 8) parts.push(`${t.tradeCount} markets covered`);
  else if (t.tradeCount >= 4) parts.push(`${t.tradeCount} active markets`);
  if (t.avgBetSize >= 1000) parts.push(`High-conviction bets (avg ${fmtMoney(t.avgBetSize)})`);
  if (parts.length === 0) return `Profitable trader with ${t.tradeCount} positions`;
  return parts.slice(0, 2).join(" · ");
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
      const res = await fetch(
        "https://data-api.polymarket.com/v1/biggest-winners?timePeriod=month&limit=100&offset=0&category=overall"
      );
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
          userName: t.userName || "",
          proxyWallet: wallet,
          pnl: 0,
          initialValue: 0,
          finalValue: 0,
          tradeCount: 0,
          topEventTitle: "",
          topEventSlug: "",
          topEventPnl: -Infinity,
        };
        cur.pnl += pnl;
        cur.initialValue += initialValue;
        cur.finalValue += Number(t.finalValue || 0);
        cur.tradeCount += 1;
        if (pnl > cur.topEventPnl) {
          cur.topEventPnl = pnl;
          cur.topEventTitle = t.eventTitle || "";
          cur.topEventSlug = t.eventSlug || "";
        }
        byWallet.set(wallet, cur);
      });

      const data = Array.from(byWallet.values()).map((t) => {
        const roi = calcRoi(t.pnl, t.initialValue);
        const estWin = estimateWinRate(roi, t.proxyWallet);
        const avgBetSize = t.tradeCount > 0 ? t.initialValue / t.tradeCount : 0;
        return { ...t, roi, estWin, avgBetSize, eventTitle: t.topEventTitle, eventSlug: t.topEventSlug };
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
    return traders.filter((t) => {
      const name = displayName(t.userName, t.proxyWallet).toLowerCase();
      return name.includes(q) || t.proxyWallet.toLowerCase().includes(q);
    });
  }, [search, traders]);

  const groupedByTier = useMemo(() => TIERS.map((tier) => ({
    tier,
    traders: filtered.filter((t) => {
      if (tier.id === "elite") return t.pnl >= 50000;
      if (tier.id === "pro") return t.pnl >= 10000 && t.pnl < 50000;
      if (tier.id === "solid") return t.pnl >= 2000 && t.pnl < 10000;
      return t.pnl >= 0 && t.pnl < 2000;
    }),
  })), [filtered]);

  const tail = useMemo(
    () => [...filtered].filter((t) => t.pnl > 0).sort((a, b) => tailScore(b) - tailScore(a)),
    [filtered]
  );
  const watchlistTraders = useMemo(
    () => traders.filter((t) => watchlist.some((w) => w.proxyWallet === t.proxyWallet)),
    [traders, watchlist]
  );
  const totalProfit = useMemo(() => filtered.reduce((s, t) => s + t.pnl, 0), [filtered]);
  const avgEstWin = useMemo(
    () => (filtered.length ? filtered.reduce((s, t) => s + t.estWin, 0) / filtered.length : 0),
    [filtered]
  );

  return (
    <>
      <Head>
        <title>CopyTrade — Polymarket Intelligence</title>
        <meta name="viewport" content="width=device-width,initial-scale=1" />
      </Head>
      <style>{`
        *{box-sizing:border-box}
        body{margin:0;background:#07070a;color:#eee;font-family:'Space Grotesk',sans-serif}
        .nav-link{padding:6px 12px;color:#777;text-decoration:none;border-radius:8px;font-weight:700}
        .nav-link.active{color:#fff;background:rgba(255,255,255,.08)}
        .stats-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
        @media(max-width:720px){.stats-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
        .tab-btn{background:none;border:none;border-bottom:2px solid transparent;color:#777;font-weight:700;cursor:pointer;padding:8px 2px;font-size:14px;font-family:'Space Grotesk',sans-serif}
        .tab-btn.active{border-bottom-color:#F5C842;color:#F5C842}
        tr.trader-row{transition:background .12s}
        tr.trader-row:hover{background:rgba(255,255,255,.04)}
        .watch-btn{border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.03);color:#bbb;border-radius:999px;padding:4px 10px;font-size:11px;cursor:pointer;font-family:'Space Grotesk',sans-serif}
        .watch-btn.watching{border-color:#4ADE80;background:rgba(74,222,128,.12);color:#4ADE80}
        .score-bar-bg{height:4px;background:rgba(255,255,255,.08);border-radius:999px;overflow:hidden}
        .score-bar-fill{height:100%;border-radius:999px;transition:width .3s}
      `}</style>

      <nav style={{ position: "sticky", top: 0, zIndex: 10, background: "rgba(7,7,10,.92)", borderBottom: "1px solid rgba(255,255,255,.07)", backdropFilter: "blur(12px)" }}>
        <div style={{ maxWidth: 1140, margin: "0 auto", padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: "linear-gradient(135deg,#F5C842,#F97316)", display: "grid", placeItems: "center", color: "#000", fontWeight: 900, fontFamily: "'Space Mono', monospace" }}>CT</div>
          <div style={{ fontWeight: 800 }}>CopyTrade</div>
          <Link href="/" className="nav-link active">Dashboard</Link>
          <Link href="/live" className="nav-link">Live Picks</Link>
          <button onClick={fetchTraders} disabled={loading} style={{ marginLeft: "auto", border: "1px solid rgba(255,255,255,.15)", background: "rgba(255,255,255,.04)", color: "#ccc", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontFamily: "'Space Mono', monospace", opacity: loading ? .5 : 1 }}>
            {loading ? "Loading…" : "Sync"}
          </button>
        </div>
      </nav>

      <main style={{ maxWidth: 1140, margin: "0 auto", padding: "20px 16px 60px" }}>

        {/* Stat cards */}
        <div className="stats-grid" style={{ marginBottom: 18 }}>
          <div style={{ border: "1px solid rgba(255,255,255,.08)", background: "rgba(255,255,255,.02)", borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ color: "#787878", fontSize: 10, letterSpacing: ".08em", fontWeight: 700, marginBottom: 4 }}>TRADERS TRACKED</div>
            <div style={{ fontSize: 26, fontWeight: 800, fontFamily: "'Space Mono', monospace" }}>{traders.length}</div>
            <div style={{ color: "#555", fontSize: 11, marginTop: 2 }}>Top Polymarket wallets this month</div>
          </div>
          <div style={{ border: "1px solid rgba(255,255,255,.08)", background: "rgba(255,255,255,.02)", borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ color: "#787878", fontSize: 10, letterSpacing: ".08em", fontWeight: 700, marginBottom: 4 }}>YOU'RE TAILING</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: "#4ADE80", fontFamily: "'Space Mono', monospace" }}>{watchlist.length}</div>
            <div style={{ color: "#555", fontSize: 11, marginTop: 2 }}>{watchlist.length === 0 ? "Watch traders to see their picks" : `${watchlist.length} trader${watchlist.length > 1 ? "s" : ""} on your watchlist`}</div>
          </div>
          <div style={{ border: "1px solid rgba(255,255,255,.08)", background: "rgba(255,255,255,.02)", borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ color: "#787878", fontSize: 10, letterSpacing: ".08em", fontWeight: 700, marginBottom: 4 }}>COMBINED PROFIT</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: "#F5C842", fontFamily: "'Space Mono', monospace" }}>{fmtMoney(totalProfit)}</div>
            <div style={{ color: "#555", fontSize: 11, marginTop: 2 }}>Total earned by tracked traders</div>
          </div>
          <div style={{ border: "1px solid rgba(255,255,255,.08)", background: "rgba(255,255,255,.02)", borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ color: "#787878", fontSize: 10, letterSpacing: ".08em", fontWeight: 700, marginBottom: 4 }}>AVG WIN RATE</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: "#38BDF8", fontFamily: "'Space Mono', monospace" }}>{fmtPct(avgEstWin)}</div>
            <div style={{ color: "#555", fontSize: 11, marginTop: 2 }}>Estimated across all traders</div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 20, marginBottom: 16, borderBottom: "1px solid rgba(255,255,255,.07)", paddingBottom: 0 }}>
          {[
            { k: "leaderboard", label: "Leaderboard" },
            { k: "tail", label: "Who To Tail" },
            { k: "watchlist", label: `My Watchlist (${watchlist.length})` },
          ].map(({ k, label }) => (
            <button key={k} className={`tab-btn${tab === k ? " active" : ""}`} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>

        {tab !== "watchlist" && (
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or wallet…"
            style={{ width: "100%", maxWidth: 300, marginBottom: 16, borderRadius: 8, border: "1px solid rgba(255,255,255,.1)", background: "rgba(255,255,255,.03)", color: "#efefef", padding: "8px 12px", fontSize: 13 }}
          />
        )}

        {loading && (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#555" }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Loading Polymarket data…</div>
            <div style={{ fontSize: 13 }}>Fetching live leaderboard</div>
          </div>
        )}
        {error && (
          <div style={{ color: "#F87171", padding: "14px 16px", background: "rgba(248,113,113,.08)", borderRadius: 10, border: "1px solid rgba(248,113,113,.2)" }}>
            {error}
          </div>
        )}

        {/* ── LEADERBOARD TAB ── */}
        {!loading && !error && tab === "leaderboard" && groupedByTier.map(({ tier, traders: list }) =>
          list.length === 0 ? null : (
            <section key={tier.id} style={{ border: "1px solid rgba(255,255,255,.07)", borderRadius: 12, overflow: "hidden", marginBottom: 14 }}>
              <div style={{ padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,.06)", display: "flex", alignItems: "center", gap: 10, background: "rgba(255,255,255,.02)" }}>
                <div style={{ width: 9, height: 9, borderRadius: 999, background: tier.color, flexShrink: 0 }} />
                <strong style={{ color: tier.color, fontSize: 12, letterSpacing: ".08em" }}>{tier.label}</strong>
                <span style={{ color: "#666", fontSize: 12 }}>{tier.desc}</span>
                <span style={{ color: "#444", fontSize: 12, marginLeft: "auto" }}>{list.length} trader{list.length !== 1 ? "s" : ""}</span>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
                  <thead>
                    <tr style={{ color: "#555", fontSize: 11, letterSpacing: ".05em" }}>
                      <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 700 }}>#</th>
                      <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 700 }}>TRADER</th>
                      <th style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700 }}>TOTAL INVESTED</th>
                      <th style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700 }}>RETURN</th>
                      <th style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700 }}>EST. WIN RATE</th>
                      <th style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700 }}>PROFIT THIS MONTH</th>
                      <th style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((t, i) => {
                      const watched = watchlist.some((w) => w.proxyWallet === t.proxyWallet);
                      const name = displayName(t.userName, t.proxyWallet);
                      return (
                        <tr key={t.id} className="trader-row" style={{ borderTop: "1px solid rgba(255,255,255,.04)" }}>
                          <td style={{ padding: "11px 12px", color: "#555", fontFamily: "'Space Mono', monospace", fontSize: 13 }}>{i + 1}</td>
                          <td style={{ padding: "11px 12px" }}>
                            <div style={{ fontWeight: 700, fontSize: 14 }}>{name}</div>
                            {t.eventTitle && (
                              <div style={{ color: "#555", fontSize: 11, marginTop: 2 }}>
                                Best call: <span style={{ color: "#888" }}>{t.eventTitle.length > 50 ? t.eventTitle.slice(0, 50) + "…" : t.eventTitle}</span>
                              </div>
                            )}
                          </td>
                          <td style={{ padding: "11px 12px", textAlign: "right", color: "#888", fontFamily: "'Space Mono', monospace", fontSize: 13 }}>{fmtMoney(t.initialValue)}</td>
                          <td style={{ padding: "11px 12px", textAlign: "right", fontFamily: "'Space Mono', monospace", fontSize: 13, color: t.roi >= 0 ? "#4ADE80" : "#F87171", fontWeight: 700 }}>{t.roi >= 0 ? "+" : ""}{fmtPct(t.roi)}</td>
                          <td style={{ padding: "11px 12px", textAlign: "right", color: "#38BDF8", fontFamily: "'Space Mono', monospace", fontSize: 13 }}>{fmtPct(t.estWin)}</td>
                          <td style={{ padding: "11px 12px", textAlign: "right", fontFamily: "'Space Mono', monospace", fontSize: 15, fontWeight: 800, color: t.pnl >= 0 ? "#4ADE80" : "#F87171" }}>
                            {t.pnl >= 0 ? "+" : ""}{fmtMoney(t.pnl)}
                          </td>
                          <td style={{ padding: "11px 12px", textAlign: "right" }}>
                            <button className={`watch-btn${watched ? " watching" : ""}`} onClick={() => toggleWatch(t)}>
                              {watched ? "✓ Watching" : "Watch"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )
        )}

        {/* ── WHO TO TAIL TAB ── */}
        {!loading && !error && tab === "tail" && (
          <div>
            <p style={{ color: "#666", fontSize: 14, margin: "0 0 18px" }}>
              Ranked by a composite Tail Score — weighted by total profit, return on investment, and number of markets covered. Higher score = more worth following.
            </p>
            <div style={{ display: "grid", gap: 12 }}>
              {tail.map((t, i) => {
                const watched = watchlist.some((w) => w.proxyWallet === t.proxyWallet);
                const tier = tierForPnl(t.pnl);
                const name = displayName(t.userName, t.proxyWallet);
                const score = tailScore(t);
                const { grade, color: gradeColor } = scoreGrade(score);
                const reason = tailReason(t);
                return (
                  <div key={t.id} style={{ border: "1px solid rgba(255,255,255,.08)", borderRadius: 14, padding: "16px 18px", background: "rgba(255,255,255,.015)" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>

                      {/* Rank + grade */}
                      <div style={{ textAlign: "center", flexShrink: 0, width: 48 }}>
                        <div style={{ color: "#444", fontSize: 11, fontFamily: "'Space Mono', monospace" }}>#{i + 1}</div>
                        <div style={{ color: gradeColor, fontWeight: 900, fontSize: 26, fontFamily: "'Space Mono', monospace", lineHeight: 1.1 }}>{grade}</div>
                        <div style={{ color: "#555", fontSize: 10, marginTop: 2 }}>{score}/100</div>
                      </div>

                      {/* Main info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                          <span style={{ fontWeight: 800, fontSize: 16 }}>{name}</span>
                          <span style={{ background: `${tier.color}22`, color: tier.color, border: `1px solid ${tier.color}44`, borderRadius: 5, padding: "1px 7px", fontSize: 10, fontWeight: 800, letterSpacing: ".06em" }}>
                            {tier.label}
                          </span>
                        </div>
                        <div style={{ color: "#4ADE80", fontWeight: 700, fontSize: 15, marginBottom: 6 }}>
                          +{fmtMoney(t.pnl)} profit this month
                        </div>
                        <div style={{ color: "#888", fontSize: 13, marginBottom: 10 }}>{reason}</div>

                        {/* Stats row */}
                        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                          {[
                            { label: "Return", value: `${t.roi >= 0 ? "+" : ""}${fmtPct(t.roi)}`, color: t.roi >= 0 ? "#4ADE80" : "#F87171" },
                            { label: "Est. win rate", value: fmtPct(t.estWin), color: "#38BDF8" },
                            { label: "Markets bet", value: t.tradeCount, color: "#eee" },
                            { label: "Avg bet size", value: fmtMoney(t.avgBetSize), color: "#eee" },
                          ].map((s) => (
                            <div key={s.label}>
                              <div style={{ color: "#555", fontSize: 10, fontWeight: 700, letterSpacing: ".06em" }}>{s.label.toUpperCase()}</div>
                              <div style={{ color: s.color, fontWeight: 700, fontFamily: "'Space Mono', monospace", fontSize: 14 }}>{s.value}</div>
                            </div>
                          ))}
                        </div>

                        {/* Score bar */}
                        <div style={{ marginTop: 12 }}>
                          <div className="score-bar-bg">
                            <div className="score-bar-fill" style={{ width: `${score}%`, background: `linear-gradient(90deg, ${gradeColor}88, ${gradeColor})` }} />
                          </div>
                        </div>

                        {/* Best call */}
                        {t.eventTitle && (
                          <div style={{ marginTop: 8, color: "#555", fontSize: 12 }}>
                            Best call: <span style={{ color: "#777" }}>{t.eventTitle.length > 70 ? t.eventTitle.slice(0, 70) + "…" : t.eventTitle}</span>
                          </div>
                        )}
                      </div>

                      {/* Watch button */}
                      <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                        <button
                          className={`watch-btn${watched ? " watching" : ""}`}
                          onClick={() => toggleWatch(t)}
                          style={{ padding: "8px 16px", fontSize: 13 }}
                        >
                          {watched ? "✓ Watching" : "Watch"}
                        </button>
                        <a
                          href={`https://polymarket.com/profile/${t.proxyWallet}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: "#38BDF8", fontSize: 11, textDecoration: "none" }}
                        >
                          View profile ↗
                        </a>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── WATCHLIST TAB ── */}
        {tab === "watchlist" && (
          <div>
            {watchlistTraders.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 0", color: "#555" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>👀</div>
                <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 6 }}>Your watchlist is empty</div>
                <div style={{ fontSize: 14, color: "#444" }}>
                  Go to the <button onClick={() => setTab("tail")} style={{ background: "none", border: "none", color: "#F5C842", cursor: "pointer", fontWeight: 700, fontSize: 14, padding: 0, fontFamily: "'Space Grotesk', sans-serif" }}>Who To Tail</button> tab and hit Watch on any trader.
                </div>
                <div style={{ fontSize: 13, marginTop: 8, color: "#444" }}>
                  Once added, their picks will appear in the <Link href="/live" style={{ color: "#38BDF8" }}>Live Picks</Link> feed.
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                <p style={{ color: "#666", fontSize: 14, margin: "0 0 4px" }}>
                  These traders' picks will appear in the Live Picks feed when you filter by "My watchlist".
                </p>
                {watchlistTraders.map((t) => {
                  const tier = tierForPnl(t.pnl);
                  const name = displayName(t.userName, t.proxyWallet);
                  const score = tailScore(t);
                  const { grade, color: gradeColor } = scoreGrade(score);
                  return (
                    <div key={t.id} style={{ border: `1px solid ${tier.color}33`, borderRadius: 12, padding: "14px 18px", display: "flex", alignItems: "center", gap: 14, background: "rgba(255,255,255,.015)" }}>
                      <div style={{ textAlign: "center", flexShrink: 0 }}>
                        <div style={{ color: gradeColor, fontWeight: 900, fontSize: 22, fontFamily: "'Space Mono', monospace" }}>{grade}</div>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                          <span style={{ fontWeight: 800 }}>{name}</span>
                          <span style={{ background: `${tier.color}22`, color: tier.color, border: `1px solid ${tier.color}44`, borderRadius: 5, padding: "1px 7px", fontSize: 10, fontWeight: 800 }}>{tier.label}</span>
                        </div>
                        <div style={{ color: "#666", fontSize: 13 }}>
                          <span style={{ color: "#4ADE80", fontWeight: 700 }}>+{fmtMoney(t.pnl)}</span>
                          {" · "}{fmtPct(t.roi)} return{" · "}Est. {fmtPct(t.estWin)} win rate{" · "}{t.tradeCount} markets
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 10, alignItems: "center", flexShrink: 0 }}>
                        <a href={`https://polymarket.com/profile/${t.proxyWallet}`} target="_blank" rel="noreferrer" style={{ color: "#38BDF8", fontSize: 12, textDecoration: "none" }}>Profile ↗</a>
                        <Link href="/live" style={{ color: "#F5C842", fontSize: 12, textDecoration: "none", fontWeight: 700 }}>See picks →</Link>
                        <button onClick={() => toggleWatch(t)} style={{ border: "1px solid rgba(248,113,113,.3)", background: "rgba(248,113,113,.06)", color: "#F87171", borderRadius: 999, padding: "4px 10px", fontSize: 11, cursor: "pointer" }}>Remove</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>
    </>
  );
}
