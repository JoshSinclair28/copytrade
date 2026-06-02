import { useCallback, useEffect, useMemo, useState } from "react";
import Head from "next/head";
import Link from "next/link";

function fmtMoney(v) {
  const n = Number(v || 0);
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}
function toMs(ts) {
  if (typeof ts === "number") return ts < 1e12 ? ts * 1000 : ts;
  const p = new Date(ts).getTime();
  return Number.isNaN(p) ? Date.now() : p;
}
function ago(ts) {
  const m = Math.floor((Date.now() - toMs(ts)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function displayName(userName, proxyWallet) {
  if (!userName || /^0x[0-9a-fA-F]{38,}$/.test(userName)) {
    return proxyWallet ? `${proxyWallet.slice(0, 6)}…${proxyWallet.slice(-4)}` : "Unknown";
  }
  return userName;
}
function seededNoise(seed, range) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 1000) / 1000) * range;
}
function tierForPnl(pnl) {
  if (pnl >= 50000) return { label: "ELITE", color: "#F5C842" };
  if (pnl >= 10000) return { label: "PRO", color: "#38BDF8" };
  if (pnl >= 2000) return { label: "SOLID", color: "#4ADE80" };
  return { label: "RISING", color: "#C084FC" };
}

const MIN_SIZES = [
  { label: "Any size", value: 0 },
  { label: "$50+", value: 50 },
  { label: "$200+", value: 200 },
  { label: "$500+", value: 500 },
  { label: "$1K+", value: 1000 },
];

export default function LivePicks() {
  const [picks, setPicks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("all");
  const [minSize, setMinSize] = useState(50);
  const [sort, setSort] = useState("recent");
  const [search, setSearch] = useState("");
  const [watchlist, setWatchlist] = useState([]);
  const [lastRefresh, setLastRefresh] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const winnersRes = await fetch(
        "https://data-api.polymarket.com/v1/biggest-winners?timePeriod=month&limit=25&offset=0&category=overall"
      );
      if (!winnersRes.ok) throw new Error(`HTTP ${winnersRes.status}`);
      const winnersRaw = await winnersRes.json();
      const winners = (Array.isArray(winnersRaw) ? winnersRaw : winnersRaw?.data || [])
        .filter((w) => w?.proxyWallet)
        .slice(0, 15);

      const chunks = await Promise.all(
        winners.map(async (w) => {
          try {
            const r = await fetch(
              `https://data-api.polymarket.com/v1/activity?user=${encodeURIComponent(w.proxyWallet)}&limit=50`
            );
            if (!r.ok) return [];
            const raw = await r.json();
            const arr = Array.isArray(raw) ? raw : raw?.data || [];
            return arr
              .filter((a) => {
                const side = (a.side || "").toString().toUpperCase();
                const type = (a.type || "").toString().toUpperCase();
                // Only show entries: BUY side, or TRADE/PURCHASE type that isn't a SELL/REDEEM
                const isBuy = side === "BUY" || type === "BUY" || type === "PURCHASE";
                const isSell = side === "SELL" || type === "SELL" || type === "REDEEM" || type === "MERGE";
                return isBuy && !isSell;
              })
              .map((a, i) => ({
                id: `${w.proxyWallet}-${a.transactionHash || a.conditionId || i}`,
                proxyWallet: w.proxyWallet,
                userName: a.name || w.userName || "",
                profileImage: a.profileImage || w.profileImage || "",
                traderPnl: Number(w.pnl || 0),
                conditionId: a.conditionId || "",
                market: a.title || a.eventTitle || a.marketTitle || "",
                outcome: (a.outcome || "").toString(),
                amount: Number(a.usdcSize || a.amount || a.size || a.usdValue || 0),
                price: Number(a.price || 0),
                timestamp: a.timestamp || a.createdAt || a.updatedAt || Date.now(),
                eventSlug: a.eventSlug || a.slug || "",
              }));
          } catch {
            return [];
          }
        })
      );

      // Deduplicate: same trader + condition + outcome within 2h → aggregate into one pick
      const grouped = new Map();
      chunks.flat().forEach((item) => {
        const bucket = Math.floor(toMs(item.timestamp) / (2 * 60 * 60 * 1000));
        const key = `${item.proxyWallet}|${item.conditionId}|${item.outcome}|${bucket}`;
        const prev = grouped.get(key);
        if (!prev) {
          grouped.set(key, { ...item, fills: 1, latestTs: toMs(item.timestamp) });
          return;
        }
        prev.amount += item.amount;
        prev.fills += 1;
        const ts = toMs(item.timestamp);
        if (ts > prev.latestTs) {
          prev.latestTs = ts;
          prev.timestamp = item.timestamp;
          prev.market = item.market || prev.market;
          prev.eventSlug = item.eventSlug || prev.eventSlug;
          prev.profileImage = item.profileImage || prev.profileImage;
        }
      });

      setPicks(Array.from(grouped.values()));
      setLastRefresh(new Date());
    } catch (e) {
      setError(e.message || "Failed to load picks");
      setPicks([]);
    } finally {
      setLoading(false);
    }
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

  const processed = useMemo(() => {
    let list = picks.filter((p) => p.amount >= minSize);
    if (filter === "watched") list = list.filter((p) => watchlist.some((w) => w.proxyWallet === p.proxyWallet));
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((p) => {
        const name = displayName(p.userName, p.proxyWallet).toLowerCase();
        return name.includes(q) || p.market.toLowerCase().includes(q);
      });
    }
    if (sort === "recent") list = [...list].sort((a, b) => b.latestTs - a.latestTs);
    else if (sort === "biggest") list = [...list].sort((a, b) => b.amount - a.amount);
    else if (sort === "trader") list = [...list].sort((a, b) => b.traderPnl - a.traderPnl);
    return list;
  }, [picks, filter, minSize, search, sort, watchlist]);

  const totalPicks = processed.length;
  const uniqueTraders = new Set(processed.map((p) => p.proxyWallet)).size;
  const totalVolume = processed.reduce((s, p) => s + p.amount, 0);

  return (
    <>
      <Head>
        <title>Live Picks — CopyTrade</title>
        <meta name="viewport" content="width=device-width,initial-scale=1" />
      </Head>
      <style>{`
        *{box-sizing:border-box}
        body{margin:0;background:#07070a;color:#eee;font-family:'Space Grotesk',sans-serif}
        .nav-link{padding:6px 12px;color:#777;text-decoration:none;border-radius:8px;font-weight:700}
        .nav-link.active{color:#fff;background:rgba(255,255,255,.08)}
        .pick-card:hover{background:rgba(255,255,255,.03)!important;border-color:rgba(255,255,255,.14)!important}
        .cta-btn{display:inline-block;background:linear-gradient(135deg,#F5C842,#F97316);color:#000;font-weight:800;font-size:13px;padding:10px 20px;border-radius:10px;text-decoration:none;text-align:center;transition:opacity .15s}
        .cta-btn:hover{opacity:.85}
        .pill-yes{background:rgba(74,222,128,.15);color:#4ADE80;border:1px solid rgba(74,222,128,.3);border-radius:6px;padding:4px 10px;font-weight:800;font-size:13px;letter-spacing:.04em}
        .pill-no{background:rgba(248,113,113,.15);color:#F87171;border:1px solid rgba(248,113,113,.3);border-radius:6px;padding:4px 10px;font-weight:800;font-size:13px;letter-spacing:.04em}
        .pill-other{background:rgba(255,255,255,.08);color:#ccc;border:1px solid rgba(255,255,255,.15);border-radius:6px;padding:4px 10px;font-weight:800;font-size:13px}
        .filter-btn{border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.03);color:#999;border-radius:999px;padding:6px 14px;cursor:pointer;font-size:12px;font-family:'Space Grotesk',sans-serif;white-space:nowrap}
        .filter-btn.active{border-color:#F5C842;background:rgba(245,200,66,.1);color:#F5C842}
      `}</style>

      <nav style={{ position: "sticky", top: 0, zIndex: 10, background: "rgba(7,7,10,.92)", borderBottom: "1px solid rgba(255,255,255,.07)", backdropFilter: "blur(12px)" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto", padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: "linear-gradient(135deg,#F5C842,#F97316)", display: "grid", placeItems: "center", color: "#000", fontWeight: 900, fontFamily: "'Space Mono', monospace" }}>CT</div>
          <div style={{ fontWeight: 800 }}>CopyTrade</div>
          <Link href="/" className="nav-link">Dashboard</Link>
          <Link href="/live" className="nav-link active">Live Picks</Link>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            {lastRefresh && <span style={{ color: "#555", fontSize: 11 }}>Updated {ago(lastRefresh)}</span>}
            <button onClick={load} disabled={loading} style={{ border: "1px solid rgba(255,255,255,.15)", background: "rgba(255,255,255,.04)", color: "#ccc", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontFamily: "'Space Mono', monospace", opacity: loading ? .5 : 1 }}>
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>
      </nav>

      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "24px 16px 60px" }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ margin: "0 0 6px", fontSize: 28, fontWeight: 900 }}>Live Picks Feed</h1>
          <p style={{ margin: 0, color: "#666", fontSize: 15 }}>
            Real bets being placed right now by Polymarket's top-ranked traders. See exactly what they're betting on and copy their moves.
          </p>
        </div>

        {/* Stats bar */}
        {!loading && !error && (
          <div style={{ display: "flex", gap: 20, marginBottom: 20, flexWrap: "wrap" }}>
            {[
              { label: "Picks shown", value: totalPicks, color: "#eee" },
              { label: "Traders active", value: uniqueTraders, color: "#F5C842" },
              { label: "Total bet volume", value: fmtMoney(totalVolume), color: "#4ADE80" },
            ].map((s) => (
              <div key={s.label} style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 10, padding: "10px 16px" }}>
                <div style={{ color: "#666", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", marginBottom: 2 }}>{s.label.toUpperCase()}</div>
                <div style={{ color: s.color, fontWeight: 800, fontSize: 20, fontFamily: "'Space Mono', monospace" }}>{s.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Filters row */}
        <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button className={`filter-btn${filter === "all" ? " active" : ""}`} onClick={() => setFilter("all")}>All traders</button>
          <button className={`filter-btn${filter === "watched" ? " active" : ""}`} onClick={() => setFilter("watched")}>My watchlist ({watchlist.length})</button>
          <div style={{ width: 1, height: 20, background: "rgba(255,255,255,.1)", margin: "0 4px" }} />
          {MIN_SIZES.map((s) => (
            <button key={s.value} className={`filter-btn${minSize === s.value ? " active" : ""}`} onClick={() => setMinSize(s.value)}>{s.label}</button>
          ))}
        </div>

        {/* Sort + search row */}
        <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ color: "#555", fontSize: 12 }}>Sort:</span>
          {[
            { id: "recent", label: "Most Recent" },
            { id: "biggest", label: "Biggest Bet" },
            { id: "trader", label: "Top Trader" },
          ].map((s) => (
            <button key={s.id} className={`filter-btn${sort === s.id ? " active" : ""}`} onClick={() => setSort(s.id)}>{s.label}</button>
          ))}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search market or trader…"
            style={{ marginLeft: "auto", maxWidth: 240, borderRadius: 8, border: "1px solid rgba(255,255,255,.1)", background: "rgba(255,255,255,.03)", color: "#efefef", padding: "7px 12px", fontSize: 13 }}
          />
        </div>

        {loading && (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#555" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Loading picks from top traders…</div>
            <div style={{ fontSize: 13 }}>Fetching activity from 15 elite wallets</div>
          </div>
        )}
        {error && <div style={{ color: "#F87171", padding: "16px", background: "rgba(248,113,113,.08)", borderRadius: 10, border: "1px solid rgba(248,113,113,.2)" }}>{error}</div>}

        {!loading && !error && processed.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#555" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
            <div style={{ fontWeight: 700 }}>No picks match your filters</div>
            <div style={{ fontSize: 13, marginTop: 6 }}>Try lowering the minimum bet size or switching to "All traders"</div>
          </div>
        )}

        {!loading && !error && (
          <div style={{ display: "grid", gap: 12 }}>
            {processed.map((pick) => {
              const name = displayName(pick.userName, pick.proxyWallet);
              const tier = tierForPnl(pick.traderPnl);
              const outcome = pick.outcome.toLowerCase();
              const isYes = outcome === "yes" || outcome === "1";
              const isNo = outcome === "no" || outcome === "0";
              const outcomeLabel = isYes ? "YES" : isNo ? "NO" : pick.outcome || "BUY";
              const pillClass = isYes ? "pill-yes" : isNo ? "pill-no" : "pill-other";
              const marketUrl = pick.eventSlug
                ? `https://polymarket.com/event/${pick.eventSlug}`
                : `https://polymarket.com`;
              const avatarLetter = name.slice(0, 2).toUpperCase();
              const avatarColor = seededNoise(pick.proxyWallet, 360);
              const hue = Math.floor(avatarColor);

              return (
                <article
                  key={pick.id}
                  className="pick-card"
                  style={{ border: "1px solid rgba(255,255,255,.08)", borderRadius: 14, padding: "16px 18px", background: "rgba(255,255,255,.015)", transition: "background .15s, border-color .15s" }}
                >
                  {/* Top row: trader identity */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                    <div style={{ width: 36, height: 36, borderRadius: "50%", overflow: "hidden", background: `hsl(${hue},60%,30%)`, display: "grid", placeItems: "center", fontWeight: 800, fontSize: 12, flexShrink: 0 }}>
                      {pick.profileImage
                        ? <img src={pick.profileImage} alt={name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        : avatarLetter}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 800, fontSize: 15 }}>{name}</span>
                        <span style={{ background: `${tier.color}22`, color: tier.color, border: `1px solid ${tier.color}44`, borderRadius: 5, padding: "1px 7px", fontSize: 10, fontWeight: 800, letterSpacing: ".06em" }}>
                          {tier.label}
                        </span>
                        <span style={{ color: "#4ADE80", fontSize: 12, fontFamily: "'Space Mono', monospace", fontWeight: 700 }}>
                          +{fmtMoney(pick.traderPnl)} this month
                        </span>
                      </div>
                    </div>
                    <div style={{ color: "#555", fontSize: 11, flexShrink: 0 }}>{ago(pick.timestamp)}</div>
                  </div>

                  {/* The pick itself */}
                  <div style={{ background: "rgba(255,255,255,.03)", borderRadius: 10, padding: "14px 16px", marginBottom: 14 }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                      <span className={pillClass}>{outcomeLabel}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 16, lineHeight: 1.35, color: "#f0f0f0" }}>
                          {pick.market || "Market data loading…"}
                        </div>
                        {pick.price > 0 && pick.price < 1 && (
                          <div style={{ color: "#888", fontSize: 12, marginTop: 4 }}>
                            Entry price: {Math.round(pick.price * 100)}¢ · Implied probability {Math.round(pick.price * 100)}%
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Bottom row: amount + CTA */}
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <div>
                      <span style={{ color: "#888", fontSize: 12 }}>Bet size: </span>
                      <span style={{ color: "#fff", fontWeight: 800, fontSize: 18, fontFamily: "'Space Mono', monospace" }}>{fmtMoney(pick.amount)}</span>
                    </div>
                    {pick.fills > 1 && (
                      <div style={{ color: "#666", fontSize: 12 }}>{pick.fills} fills</div>
                    )}
                    <div style={{ marginLeft: "auto" }}>
                      <a href={marketUrl} target="_blank" rel="noreferrer" className="cta-btn">
                        Copy this trade →
                      </a>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <p style={{ color: "#444", fontSize: 12, marginTop: 24, textAlign: "center" }}>
          Data pulled from Polymarket's public API. Picks auto-refresh every 2 minutes. Past performance does not guarantee future results.
        </p>
      </main>
    </>
  );
}
