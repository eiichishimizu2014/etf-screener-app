import { useState, useEffect } from "react";

// ── 初期監視リスト（ポジション情報のみ保持） ─────────────────────────
const INITIAL_TICKERS = [
  { ticker: "BBAI", position: null },
  { ticker: "PATH", position: { entryPrice: 14.20, shares: 100, entryDate: "2026-04-28", holdDays: 21 } },
  { ticker: "AI",   position: { entryPrice: 20.50, shares: 50,  entryDate: "2026-05-02", holdDays: 17 } },
  { ticker: "SOUN", position: { entryPrice: 10.50, shares: 200, entryDate: "2026-05-05", holdDays: 14 } },
];

// 定性的な堀の説明 (人間判断) — 新規銘柄はAPIの業種がフォールバック
const MOAT_DESCRIPTIONS = {
  BBAI: "政府・国防のセキュリティ認定",
  PATH: "レガシーシステムへの深い統合",
  AI:   "重工業・エネルギー特化のノウハウ",
  SOUN: "音声特許・自動車メーカー契約",
};

const MOCK_ETF_LIST = [
  { ticker: "SPY",  name: "S&P500 ETF", category: "米国全体", signal: "yellow", expense: 0.09, aum: "5200億ドル", ret1y: 18.2, risk: "中", desc: "米国大型株500社" },
  { ticker: "TLT",  name: "長期国債ETF", category: "債券",    signal: "green",  expense: 0.15, aum: "430億ドル",  ret1y: 4.1,  risk: "中", desc: "米国長期国債（20年超）", scenario: 85 },
  { ticker: "XLF",  name: "金融セクターETF", category: "金融",signal: "green",  expense: 0.09, aum: "360億ドル",  ret1y: 22.1, risk: "中", desc: "米国金融セクター", scenario: 78 },
  { ticker: "GLD",  name: "金ETF",      category: "コモディティ", signal: "yellow", expense: 0.40, aum: "580億ドル", ret1y: 26.3, risk: "低", desc: "金現物連動型ETF", scenario: 72 },
  { ticker: "VNQ",  name: "不動産ETF",  category: "債券",    signal: "yellow", expense: 0.12, aum: "340億ドル",  ret1y: 9.3,  risk: "中", desc: "米国REIT分散投資", scenario: 80 },
];

const CATEGORIES = ["すべて", "米国全体", "日本全体", "テクノロジー", "ヘルスケア", "金融", "高配当", "新興国", "債券", "金融政策シナリオ"];
const SCENARIOS  = ["利上げ局面", "利下げ局面", "量的緩和（QE）", "スタグフレーション"];

// ── シグナル設定 ──────────────────────────────────────────
const SIGNAL_CFG = {
  entry:       { label: "🚀 エントリー候補",  color: "#15803d", bg: "#dcfce7", border: "#22c55e" },
  entry_fail:  { label: "⚠️ 条件不足",        color: "#92400e", bg: "#fef9c3", border: "#f59e0b" },
  hold:        { label: "✅ 保有継続",         color: "#1d4ed8", bg: "#dbeafe", border: "#3b82f6" },
  ma_exit:     { label: "🟡 MA撤退シグナル",   color: "#92400e", bg: "#fef9c3", border: "#f59e0b" },
  stop_loss:   { label: "🔴 損切りライン接近", color: "#b91c1c", bg: "#fee2e2", border: "#ef4444" },
  take_profit: { label: "✅ 利確ライン到達",   color: "#15803d", bg: "#dcfce7", border: "#22c55e" },
  time_stop:   { label: "⏱ 時間切れ撤退",     color: "#92400e", bg: "#fef9c3", border: "#f59e0b" },
  half_cut:    { label: "⚡ 半分損切り推奨",   color: "#b91c1c", bg: "#fee2e2", border: "#ef4444" },
  loading:     { label: "⏳ データ取得中",     color: "#64748b", bg: "#f1f5f9", border: "#94a3b8" },
};

// ── ユーティリティ ──────────────────────────────────────
const alertColor = { green: "#22c55e", yellow: "#f59e0b", red: "#ef4444" };
const signalColor = { green: "#22c55e", yellow: "#f59e0b", red: "#ef4444" };

function createMockEntry(ticker, position = null) {
  return {
    ticker: ticker.toUpperCase(),
    name: ticker.toUpperCase(),
    type: "stock",
    currency: /^\d{4}\.T$/.test(ticker) ? "JPY" : "USD",
    price: null, change: null, ma25: null,
    rsi: null, atrRatio: null, volRatio: null,
    signal: "loading",
    filters: { rsi: null, atr: null, vol: null },
    position,
    updated: "取得中...",
  };
}

// ── コンポーネント ──────────────────────────────────────

function SignalBadge({ signal }) {
  const cfg = SIGNAL_CFG[signal] || SIGNAL_CFG.loading;
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 20,
      background: cfg.bg, color: cfg.color, whiteSpace: "nowrap",
    }}>{cfg.label}</span>
  );
}

function FilterRow({ filters }) {
  return (
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
      {[["rsi", "RSI"], ["atr", "ATR"], ["vol", "出来高"]].map(([key, label]) => (
        <span key={key} style={{
          fontSize: 10, padding: "1px 7px", borderRadius: 10, fontWeight: 600,
          background: filters[key] === true ? "#dcfce7" : filters[key] === false ? "#fee2e2" : "#f1f5f9",
          color: filters[key] === true ? "#15803d" : filters[key] === false ? "#b91c1c" : "#64748b",
        }}>
          {filters[key] === true ? "✅" : filters[key] === false ? "❌" : "–"} {label}
        </span>
      ))}
    </div>
  );
}

function WatchCard({ item, onClick, onRemove }) {
  const cfg = SIGNAL_CFG[item.signal] || SIGNAL_CFG.loading;
  const sym = item.currency === "JPY" ? "¥" : "$";
  const pnlPct = item.position && item.price != null
    ? (item.price - item.position.entryPrice) / item.position.entryPrice * 100
    : null;
  const pnlJpy = item.position && item.price != null
    ? Math.round(item.position.shares * (item.price - item.position.entryPrice) * (item.currency === "USD" ? 150 : 1))
    : null;

  return (
    <div style={{
      background: "#fff", borderRadius: 14, padding: "14px 16px",
      marginBottom: 10, boxShadow: "0 1px 8px #0001",
      borderLeft: `4px solid ${cfg.border}`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div onClick={onClick} style={{ cursor: "pointer", flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontWeight: 800, fontSize: 16, color: "#111" }}>{item.ticker}</span>
            <span style={{ fontSize: 11, background: "#f3f4f6", padding: "1px 6px", borderRadius: 8, color: "#666" }}>
              {item.type === "etf" ? "ETF" : "個別株"}
            </span>
          </div>
          <div style={{ fontSize: 12, color: "#555", marginTop: 1 }}>{item.name}</div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <div style={{ textAlign: "right" }}>
            {item.price != null
              ? <div style={{ fontWeight: 700, fontSize: 16 }}>{sym}{item.price.toLocaleString()}</div>
              : <div style={{ fontWeight: 700, fontSize: 14, color: "#94a3b8" }}>---</div>
            }
            {item.change != null && (
              <div style={{ fontSize: 12, color: item.change >= 0 ? "#22c55e" : "#ef4444", fontWeight: 600 }}>
                {item.change >= 0 ? "▲" : "▼"}{Math.abs(item.change)}%
              </div>
            )}
          </div>
          <button onClick={onRemove} style={{
            background: "none", border: "none", color: "#cbd5e1",
            cursor: "pointer", fontSize: 14, padding: "2px 4px", marginTop: 2,
          }}>✕</button>
        </div>
      </div>

      <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <SignalBadge signal={item.signal} />
        {pnlPct != null && (
          <span style={{
            fontSize: 11, fontWeight: 700,
            color: pnlPct >= 0 ? "#15803d" : "#b91c1c",
            background: pnlPct >= 0 ? "#dcfce7" : "#fee2e2",
            padding: "2px 9px", borderRadius: 20,
          }}>
            {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(1)}% / {pnlJpy >= 0 ? "+" : ""}¥{pnlJpy?.toLocaleString()}
          </span>
        )}
      </div>

      {item.price != null && (
        <div style={{ marginTop: 9, display: "flex", gap: 14, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "#64748b" }}>
            MA25: <strong style={{ color: item.price >= item.ma25 ? "#22c55e" : "#ef4444" }}>
              {sym}{item.ma25?.toFixed(2)}
            </strong>
          </span>
          {item.rsi != null && (
            <span style={{ fontSize: 11, color: "#64748b" }}>
              RSI: <strong style={{ color: item.rsi > 75 || item.rsi < 30 ? "#ef4444" : "#22c55e" }}>
                {item.rsi}
              </strong>
            </span>
          )}
          {item.volRatio != null && (
            <span style={{ fontSize: 11, color: "#64748b" }}>
              出来高: <strong style={{ color: item.volRatio >= 1 ? "#22c55e" : "#f59e0b" }}>
                {item.volRatio}x
              </strong>
            </span>
          )}
          {item.position && (
            <span style={{ fontSize: 11, color: "#64748b" }}>
              保有 <strong>{item.position.holdDays}日</strong>
            </span>
          )}
        </div>
      )}

      {(item.signal === "entry" || item.signal === "entry_fail") && (
        <div style={{ marginTop: 8 }}>
          <FilterRow filters={item.filters} />
        </div>
      )}

      <div style={{ fontSize: 10, color: "#bbb", marginTop: 8, textAlign: "right" }}>更新: {item.updated}</div>
    </div>
  );
}

function WatchDetail({ item, onBack, onRemove }) {
  const cfg = SIGNAL_CFG[item.signal] || SIGNAL_CFG.loading;
  const sym = item.currency === "JPY" ? "¥" : "$";
  const pnlPct = item.position && item.price != null
    ? (item.price - item.position.entryPrice) / item.position.entryPrice * 100
    : null;
  const pnlJpy = item.position && item.price != null
    ? Math.round(item.position.shares * (item.price - item.position.entryPrice) * (item.currency === "USD" ? 150 : 1))
    : null;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <button onClick={onBack} style={{
          background: "none", border: "none", color: "#3b82f6",
          fontSize: 13, cursor: "pointer", padding: 0,
        }}>← 戻る</button>
        <button onClick={onRemove} style={{
          background: "#fee2e2", border: "none", color: "#b91c1c",
          fontSize: 12, fontWeight: 700, cursor: "pointer",
          padding: "4px 12px", borderRadius: 8,
        }}>リストから削除</button>
      </div>

      <div style={{ background: "#fff", borderRadius: 14, padding: 16, boxShadow: "0 1px 8px #0001", borderTop: `4px solid ${cfg.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 22, color: "#111" }}>{item.ticker}</div>
            <div style={{ fontSize: 14, color: "#666", marginTop: 2 }}>{item.name}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            {item.price != null
              ? <div style={{ fontWeight: 800, fontSize: 22 }}>{sym}{item.price.toLocaleString()}</div>
              : <div style={{ color: "#94a3b8", fontSize: 16 }}>---</div>
            }
            {item.change != null && (
              <div style={{ fontSize: 14, color: item.change >= 0 ? "#22c55e" : "#ef4444", fontWeight: 700 }}>
                {item.change >= 0 ? "▲" : "▼"}{Math.abs(item.change)}%
              </div>
            )}
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <SignalBadge signal={item.signal} />
        </div>

        {item.price != null && (
          <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {[
              { label: "現在値",   value: `${sym}${item.price.toLocaleString()}` },
              { label: "MA25",    value: `${sym}${item.ma25?.toFixed(2)}`, color: item.price >= item.ma25 ? "#22c55e" : "#ef4444" },
              { label: "RSI(14)", value: item.rsi != null ? `${item.rsi}` : "–", color: item.rsi > 75 || item.rsi < 30 ? "#ef4444" : "#22c55e" },
              { label: "ATR比率", value: item.atrRatio != null ? `${item.atrRatio}x` : "–", color: item.atrRatio > 1.5 ? "#ef4444" : "#22c55e" },
              { label: "出来高比", value: item.volRatio != null ? `${item.volRatio}x` : "–", color: item.volRatio >= 1 ? "#22c55e" : "#f59e0b" },
              { label: "通貨",    value: item.currency },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: "#f8fafc", borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: color || "#1e293b" }}>{value}</div>
              </div>
            ))}
          </div>
        )}

        {(item.signal === "entry" || item.signal === "entry_fail") && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 8 }}>エントリーフィルター</div>
            {[
              { key: "rsi", label: "RSI（30〜75範囲内）" },
              { key: "atr", label: "ATR（MA比1.5倍以内）" },
              { key: "vol", label: "出来高（20日MA以上）" },
            ].map(({ key, label }) => (
              <div key={key} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f1f5f9" }}>
                <span style={{ fontSize: 13, color: "#475569" }}>{label}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: item.filters[key] ? "#15803d" : "#b91c1c" }}>
                  {item.filters[key] ? "✅ 通過" : "❌ 未達"}
                </span>
              </div>
            ))}
          </div>
        )}

        {item.position && (
          <div style={{ marginTop: 14, padding: 12, background: pnlPct >= 0 ? "#f0fdf4" : "#fff1f2", borderRadius: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 8 }}>保有ポジション</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <div style={{ fontSize: 12, color: "#64748b" }}>取得価格: <strong>{sym}{item.position.entryPrice.toLocaleString()}</strong></div>
              <div style={{ fontSize: 12, color: "#64748b" }}>株数: <strong>{item.position.shares}株</strong></div>
              <div style={{ fontSize: 12, color: "#64748b" }}>エントリー日: <strong>{item.position.entryDate}</strong></div>
              <div style={{ fontSize: 12, color: "#64748b" }}>保有日数: <strong>{item.position.holdDays}日</strong></div>
            </div>
            {pnlPct != null && (
              <div style={{ marginTop: 10, textAlign: "center" }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: pnlPct >= 0 ? "#15803d" : "#b91c1c" }}>
                  {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%
                </div>
                <div style={{ fontSize: 14, color: pnlPct >= 0 ? "#15803d" : "#b91c1c", fontWeight: 700 }}>
                  {pnlJpy >= 0 ? "+" : ""}¥{pnlJpy?.toLocaleString()}（円換算）
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ fontSize: 10, color: "#bbb", marginTop: 12, textAlign: "right" }}>更新: {item.updated}</div>
      </div>
    </div>
  );
}

function MoatCard({ item }) {
  const fetching = item.erosion == null && item.hasData == null;  // まだAPI未応答
  const noData   = item.hasData === false;                        // API応答済みだが財務データなし
  const erosion  = item.erosion ?? 0;
  const m        = item.metrics || {};
  return (
    <div style={{
      background: "#fff", borderRadius: 14, padding: "14px 16px",
      marginBottom: 10, boxShadow: "0 1px 8px #0001",
      borderLeft: `4px solid ${alertColor[item.alert] ?? "#94a3b8"}`
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <span style={{ fontWeight: 800, fontSize: 15 }}>{item.ticker}</span>
          <span style={{ fontSize: 12, color: "#888", marginLeft: 6 }}>{item.name}</span>
        </div>
        {fetching ? <span style={{ fontSize: 13, color: "#94a3b8" }}>⏳</span>
          : noData  ? <span style={{ fontSize: 13, color: "#94a3b8" }}>－</span>
          : <span style={{ fontSize: 18 }}>{item.alert === "green" ? "🟢" : item.alert === "yellow" ? "🟡" : "🔴"}</span>
        }
      </div>
      <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>堀: {item.moat}</div>

      {noData && (
        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6, background: "#f8fafc", borderRadius: 8, padding: "6px 10px" }}>
          ⚠️ 財務データを取得できませんでした（ニュースのみ表示）
        </div>
      )}

      {/* ファンダメンタルズ指標 */}
      {!fetching && !noData && (
        <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
          {m.grossMargin != null && (
            <span style={{ fontSize: 11, color: "#64748b" }}>粗利率 <strong style={{ color: m.grossMargin > 40 ? "#22c55e" : "#ef4444" }}>{m.grossMargin}%</strong></span>
          )}
          {m.revenueGrowth != null && (
            <span style={{ fontSize: 11, color: "#64748b" }}>売上成長 <strong style={{ color: m.revenueGrowth > 0 ? "#22c55e" : "#ef4444" }}>{m.revenueGrowth > 0 ? "+" : ""}{m.revenueGrowth}%</strong></span>
          )}
          {m.operatingMargin != null && (
            <span style={{ fontSize: 11, color: "#64748b" }}>営業利益率 <strong style={{ color: m.operatingMargin > 0 ? "#22c55e" : "#ef4444" }}>{m.operatingMargin}%</strong></span>
          )}
          {m.recommendation != null && (
            <span style={{ fontSize: 11, color: "#64748b" }}>アナリスト <strong style={{ color: m.recommendation <= 2 ? "#22c55e" : m.recommendation >= 3.5 ? "#ef4444" : "#f59e0b" }}>{m.recommendation}</strong></span>
          )}
        </div>
      )}

      {!fetching && !noData && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#888", marginBottom: 3 }}>
            <span>堀の侵食度</span>
            <span style={{ fontWeight: 700, color: erosion > 60 ? "#ef4444" : erosion > 30 ? "#f59e0b" : "#22c55e" }}>{erosion}点</span>
          </div>
          <div style={{ background: "#f0f0f0", borderRadius: 4, height: 6, overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 4, width: `${erosion}%`, background: erosion > 60 ? "#ef4444" : erosion > 30 ? "#f59e0b" : "#22c55e" }} />
          </div>
        </div>
      )}
      {item.news ? <div style={{ fontSize: 11, color: "#555", marginTop: 8, lineHeight: 1.5 }}>📰 {item.news}</div>
                 : fetching ? <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 8 }}>ニュース取得中...</div>
                 : null}
    </div>
  );
}

function MoatDetail({ item, onBack }) {
  const loading = item.erosion == null && item.hasData == null;
  const noData  = item.hasData === false;
  const erosion = item.erosion ?? 0;
  const m = item.metrics || {};
  const breakdown = item.breakdown || [];
  const newsItems = item.newsItems || [];

  const verdict = erosion >= 60
    ? { label: "🔴 撤退を検討", color: "#b91c1c", bg: "#fee2e2", sub: "堀が大きく侵食されています。中期保有は高リスクです。" }
    : erosion >= 30
    ? { label: "🟡 継続監視", color: "#92400e", bg: "#fef9c3", sub: "一部の優位性が揺らいでいます。四半期ごとに再評価してください。" }
    : { label: "🟢 保有継続", color: "#15803d", bg: "#dcfce7", sub: "競争優位性は健在です。中期保有に問題ありません。" };

  const statusIcon = { green: "✅", yellow: "⚠️", red: "❌" };

  return (
    <div>
      <button onClick={onBack} style={{
        background: "none", border: "none", color: "#3b82f6",
        fontSize: 13, cursor: "pointer", padding: "0 0 10px",
      }}>← 堀一覧へ戻る</button>

      {/* ヘッダー */}
      <div style={{ background: "#fff", borderRadius: 14, padding: "14px 16px", marginBottom: 10, boxShadow: "0 1px 8px #0001" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 20 }}>{item.ticker}</div>
            <div style={{ fontSize: 13, color: "#666", marginTop: 2 }}>{item.name}</div>
          </div>
          {loading
            ? <span style={{ fontSize: 14, color: "#94a3b8" }}>⏳ 取得中</span>
            : <span style={{ fontSize: 22 }}>{item.alert === "green" ? "🟢" : item.alert === "yellow" ? "🟡" : "🔴"}</span>
          }
        </div>
        <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
          🏰 <strong>堀の源泉：</strong>{item.moat}
        </div>
      </div>

      {/* 財務データ取得不可バナー */}
      {noData && (
        <div style={{ background: "#f1f5f9", borderRadius: 12, padding: "12px 16px", marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#64748b" }}>⚠️ 財務データを取得できませんでした</div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
            Yahoo Finance の財務 API が一時的に利用不可です。ニュースは引き続き確認できます。
          </div>
        </div>
      )}

      {/* 中期判断バナー */}
      {!loading && !noData && (
        <div style={{ background: verdict.bg, borderRadius: 12, padding: "12px 16px", marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 1 }}>中期保有判断</div>
          <div style={{ fontSize: 17, fontWeight: 800, color: verdict.color, marginTop: 4 }}>{verdict.label}</div>
          <div style={{ fontSize: 12, color: verdict.color, marginTop: 3, opacity: 0.85 }}>{verdict.sub}</div>
          <div style={{ marginTop: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#888", marginBottom: 4 }}>
              <span>侵食度スコア</span>
              <span style={{ fontWeight: 700, color: verdict.color }}>{erosion} / 100点</span>
            </div>
            <div style={{ background: "#fff8", borderRadius: 4, height: 7, overflow: "hidden" }}>
              <div style={{ height: "100%", borderRadius: 4, width: `${erosion}%`, background: verdict.color }} />
            </div>
          </div>
        </div>
      )}

      {/* 侵食度 内訳 */}
      {!noData && breakdown.length > 0 && (
        <div style={{ background: "#fff", borderRadius: 14, padding: "14px 16px", marginBottom: 10, boxShadow: "0 1px 8px #0001" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 10 }}>📊 侵食度の内訳</div>
          {breakdown.map((b, i) => (
            <div key={i} style={{ borderBottom: i < breakdown.length - 1 ? "1px solid #f1f5f9" : "none", paddingBottom: 10, marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 13 }}>{statusIcon[b.status]}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>{b.factor}</span>
                </div>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
                  background: b.points === 0 ? "#dcfce7" : b.status === "red" ? "#fee2e2" : "#fef9c3",
                  color: b.points === 0 ? "#15803d" : b.status === "red" ? "#b91c1c" : "#92400e",
                }}>{b.points === 0 ? "問題なし" : `+${b.points}点`}</span>
              </div>
              <div style={{ fontSize: 11, color: "#64748b", lineHeight: 1.5, paddingLeft: 20 }}>{b.detail}</div>
            </div>
          ))}
        </div>
      )}

      {/* ファンダメンタルズ指標 */}
      {!loading && !noData && (
        <div style={{ background: "#fff", borderRadius: 14, padding: "14px 16px", marginBottom: 10, boxShadow: "0 1px 8px #0001" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 10 }}>📈 主要指標</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {[
              { label: "粗利率",      value: m.grossMargin     != null ? `${m.grossMargin}%`     : "–", color: m.grossMargin > 40 ? "#22c55e" : m.grossMargin > 20 ? "#f59e0b" : "#ef4444" },
              { label: "売上成長率",   value: m.revenueGrowth   != null ? `${m.revenueGrowth > 0 ? "+" : ""}${m.revenueGrowth}%` : "–", color: m.revenueGrowth > 5 ? "#22c55e" : m.revenueGrowth > -5 ? "#f59e0b" : "#ef4444" },
              { label: "営業利益率",   value: m.operatingMargin != null ? `${m.operatingMargin}%` : "–", color: m.operatingMargin > 0 ? "#22c55e" : "#ef4444" },
              { label: "ROE",         value: m.roe             != null ? `${m.roe}%`             : "–", color: m.roe > 10 ? "#22c55e" : m.roe > 0 ? "#f59e0b" : "#ef4444" },
              { label: "アナリスト評価", value: m.recommendation  != null ? `${m.recommendation} / 5` : "–", color: m.recommendation <= 2 ? "#22c55e" : m.recommendation >= 3.5 ? "#ef4444" : "#f59e0b" },
              { label: "空売り比率",   value: m.shortPct        != null ? `${m.shortPct}%`       : "–", color: m.shortPct < 10 ? "#22c55e" : m.shortPct < 20 ? "#f59e0b" : "#ef4444" },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: "#f8fafc", borderRadius: 10, padding: "9px 11px" }}>
                <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 3 }}>{label}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color }}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 最新ニュース */}
      <div style={{ background: "#fff", borderRadius: 14, padding: "14px 16px", marginBottom: 10, boxShadow: "0 1px 8px #0001" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 10 }}>📰 最新ニュース</div>
        {newsItems.length === 0 ? (
          <div style={{ fontSize: 12, color: "#94a3b8" }}>{loading ? "ニュース取得中..." : "ニュースが見つかりませんでした"}</div>
        ) : (
          newsItems.map((n, i) => (
            <div key={i} style={{ borderBottom: i < newsItems.length - 1 ? "1px solid #f1f5f9" : "none", paddingBottom: 10, marginBottom: 10 }}>
              {n.link ? (
                <a href={n.link} target="_blank" rel="noopener noreferrer" style={{
                  fontSize: 13, color: "#1e293b", lineHeight: 1.5, fontWeight: 500,
                  textDecoration: "none", display: "block",
                }}>
                  {n.title}
                  <span style={{ fontSize: 11, color: "#3b82f6", marginLeft: 5 }}>↗</span>
                </a>
              ) : (
                <div style={{ fontSize: 13, color: "#1e293b", lineHeight: 1.5, fontWeight: 500 }}>{n.title}</div>
              )}
              <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4, display: "flex", gap: 8 }}>
                {n.publisher && <span>{n.publisher}</span>}
                {n.pubDate && <span>{n.pubDate.slice(0, 10)}</span>}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ETFCard({ etf, showScenario }) {
  return (
    <div style={{
      background: "#fff", borderRadius: 14, padding: "14px 16px",
      marginBottom: 10, boxShadow: "0 1px 8px #0001",
      border: showScenario && etf.scenario >= 70 ? "2px solid #22c55e" : "2px solid transparent",
      opacity: showScenario && !etf.scenario ? 0.45 : 1,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: signalColor[etf.signal], display: "inline-block" }} />
            <span style={{ fontWeight: 800, fontSize: 15 }}>{etf.ticker}</span>
            <span style={{ fontSize: 11, background: "#f3f4f6", padding: "1px 6px", borderRadius: 8, color: "#666" }}>{etf.category}</span>
          </div>
          <div style={{ fontSize: 12, color: "#555", marginTop: 2 }}>{etf.name}</div>
          <div style={{ fontSize: 11, color: "#999", marginTop: 1 }}>{etf.desc}</div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: etf.ret1y >= 0 ? "#22c55e" : "#ef4444" }}>
            {etf.ret1y >= 0 ? "+" : ""}{etf.ret1y}%
          </div>
          <div style={{ fontSize: 10, color: "#bbb" }}>1年</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
        <span style={{ fontSize: 11, color: "#888" }}>経費率 {etf.expense}%</span>
        <span style={{ fontSize: 11, color: "#888" }}>AUM {etf.aum}</span>
        <span style={{ fontSize: 11, color: "#888" }}>リスク {etf.risk}</span>
      </div>
      {showScenario && etf.scenario && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#888", marginBottom: 3 }}>
            <span>シナリオ適合度</span>
            <span style={{ fontWeight: 700, color: "#22c55e" }}>{etf.scenario}点</span>
          </div>
          <div style={{ background: "#f0f0f0", borderRadius: 4, height: 5 }}>
            <div style={{ height: "100%", borderRadius: 4, width: `${etf.scenario}%`, background: "#22c55e" }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── メインアプリ ─────────────────────────────────────────
export default function App() {
  const [tab, setTab]             = useState("watch");
  const [watchlist, setWatchlist] = useState(() =>
    INITIAL_TICKERS.map(({ ticker, position }) => createMockEntry(ticker, position))
  );

  const [moatData, setMoatData] = useState({});

  const loadTicker = async (ticker) => {
    try {
      const data = await fetch(`/api/quote/${ticker}`).then(r => r.json());
      setWatchlist(prev =>
        prev.map(w => w.ticker === ticker
          ? { ...w, ...data, position: w.position, type: "stock" }
          : w
        )
      );
    } catch {
      setWatchlist(prev =>
        prev.map(w => w.ticker === ticker
          ? { ...w, updated: "取得失敗" }
          : w
        )
      );
    }
  };

  const loadMoat = async (ticker) => {
    try {
      const data = await fetch(`/api/moat/${ticker}`).then(r => r.json());
      setMoatData(prev => ({ ...prev, [ticker]: data }));
    } catch {
      setMoatData(prev => ({
        ...prev,
        [ticker]: { ticker, alert: "yellow", erosion: null, news: "取得失敗", metrics: {} },
      }));
    }
  };

  useEffect(() => {
    INITIAL_TICKERS.forEach(({ ticker }) => {
      loadTicker(ticker);
      loadMoat(ticker);
    });
  }, []);
  const [category, setCategory]   = useState("すべて");
  const [scenario, setScenario]   = useState(null);
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages]   = useState([
    { role: "ai", text: "こんにちは！「AAPLを追加して」「SOUNを削除して」など、監視銘柄の追加・削除ができます。" }
  ]);
  const [selectedWatch, setSelectedWatch] = useState(null);
  const [selectedMoat, setSelectedMoat]   = useState(null);

  const removeFromWatchlist = (ticker) => {
    setWatchlist(prev => prev.filter(w => w.ticker !== ticker));
    if (selectedWatch?.ticker === ticker) setSelectedWatch(null);
  };

  const sendChat = () => {
    if (!chatInput.trim()) return;
    const userMsg = chatInput.trim();
    setMessages(m => [...m, { role: "user", text: userMsg }]);
    setChatInput("");

    setTimeout(() => {
      const upper = userMsg.toUpperCase();
      const tickerMatch = upper.match(/\b([A-Z]{1,5}(?:\.T)?|[0-9]{4}\.T)\b/);
      const ticker = tickerMatch ? tickerMatch[0] : null;
      const isAdd    = userMsg.includes("追加") || (userMsg.includes("監視") && !userMsg.includes("削除"));
      const isRemove = userMsg.includes("削除") || userMsg.includes("外して") || userMsg.includes("消して");

      let reply = "";

      if (isAdd && ticker) {
        const exists = watchlist.find(w => w.ticker === ticker);
        if (exists) {
          reply = `「${ticker}」はすでに監視リストに登録されています。`;
        } else {
          setWatchlist(prev => [...prev, createMockEntry(ticker)]);
          loadTicker(ticker);
          loadMoat(ticker);
          reply = `「${ticker}」を監視リストに追加しました。`;
        }
      } else if (isRemove && ticker) {
        const exists = watchlist.find(w => w.ticker === ticker);
        if (!exists) {
          reply = `「${ticker}」は監視リストに見つかりません。`;
        } else {
          removeFromWatchlist(ticker);
          reply = `「${ticker}」を監視リストから削除しました。`;
        }
      } else if (!ticker && (isAdd || isRemove)) {
        reply = "ティッカーシンボルを指定してください。例:「AAPLを追加して」「SOUNを削除して」";
      } else if (userMsg.includes("利下げ")) {
        reply = "利下げ局面シナリオに切り替えました。TLT・VNQ・XLUが上位にランクインしています。";
      } else if (userMsg.includes("利上げ")) {
        reply = "利上げ局面シナリオに切り替えました。SHY・XLF・XLEが有利とされています。";
      } else {
        reply = "銘柄の追加は「XXXを追加して」、削除は「XXXを削除して」で操作できます。";
      }

      setMessages(m => [...m, { role: "ai", text: reply }]);
    }, 700);
  };

  const TAB_ITEMS = [
    { id: "watch", label: "監視", icon: "👁" },
    { id: "moat",  label: "堀",   icon: "🏰" },
    { id: "etf",   label: "ETF",  icon: "📊" },
    { id: "chat",  label: "チャット", icon: "💬" },
  ];

  return (
    <div style={{
      maxWidth: 430, margin: "0 auto", minHeight: "100vh",
      background: "#f5f6f8", fontFamily: "'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif",
      display: "flex", flexDirection: "column"
    }}>

      {/* ヘッダー */}
      <div style={{
        background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
        padding: "16px 18px 12px", color: "#fff", flexShrink: 0
      }}>
        <div style={{ fontSize: 11, color: "#94a3b8", letterSpacing: 2, textTransform: "uppercase" }}>ETF & 銘柄スクリーナー</div>
        <div style={{ fontSize: 20, fontWeight: 800, marginTop: 2 }}>投資監視ダッシュボード</div>
        <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
          <span style={{ color: "#22c55e" }}>● リアルタイム取得（Yahoo Finance）</span>
        </div>
      </div>

      {/* コンテンツ */}
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 14px 80px" }}>

        {/* === 監視タブ === */}
        {tab === "watch" && (
          <>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#334155", marginBottom: 10 }}>
              📋 監視リスト <span style={{ fontWeight: 400, fontSize: 11, color: "#94a3b8" }}>（{watchlist.length}銘柄）</span>
            </div>

            <div style={{
              background: "#fff", borderRadius: 10, padding: "8px 12px",
              marginBottom: 12, display: "flex", gap: 10, flexWrap: "wrap",
            }}>
              {["entry", "hold", "ma_exit", "stop_loss"].map(s => (
                <span key={s} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#64748b" }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: SIGNAL_CFG[s].border, display: "inline-block" }} />
                  {SIGNAL_CFG[s].label.replace(/^[^ ]+ /, "")}
                </span>
              ))}
            </div>

            {selectedWatch ? (
              <WatchDetail
                item={selectedWatch}
                onBack={() => setSelectedWatch(null)}
                onRemove={() => removeFromWatchlist(selectedWatch.ticker)}
              />
            ) : watchlist.length === 0 ? (
              <div style={{ textAlign: "center", color: "#94a3b8", fontSize: 14, padding: "40px 0" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
                監視銘柄がありません<br />
                <span style={{ fontSize: 12 }}>チャットから銘柄を追加してください</span>
              </div>
            ) : (
              watchlist.map((item) => (
                <WatchCard
                  key={item.ticker}
                  item={item}
                  onClick={() => setSelectedWatch(item)}
                  onRemove={() => removeFromWatchlist(item.ticker)}
                />
              ))
            )}
          </>
        )}

        {/* === 堀タブ === */}
        {tab === "moat" && (
          <>
            {selectedMoat ? (
              <MoatDetail
                item={selectedMoat}
                onBack={() => setSelectedMoat(null)}
              />
            ) : (
              <>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#334155", marginBottom: 6 }}>🏰 堀（競争優位性）監視</div>
                <div style={{
                  background: "#fefce8", border: "1px solid #fde047", borderRadius: 10,
                  padding: "8px 12px", marginBottom: 12, fontSize: 12, color: "#854d0e"
                }}>
                  💡 銘柄をタップすると侵食度の内訳・最新ニュースを確認できます
                </div>
                {watchlist.map(({ ticker }) => {
                  const d = moatData[ticker];
                  const item = {
                    ticker,
                    name:      d?.name      ?? ticker,
                    moat:      MOAT_DESCRIPTIONS[ticker] ?? d?.moat ?? ticker,
                    alert:     d?.alert     ?? "yellow",
                    erosion:   d?.erosion   ?? null,
                    news:      d?.news      ?? null,
                    newsItems: d?.newsItems ?? [],
                    breakdown: d?.breakdown ?? [],
                    metrics:   d?.metrics   ?? {},
                  };
                  return (
                    <div key={ticker} onClick={() => setSelectedMoat(item)} style={{ cursor: "pointer" }}>
                      <MoatCard item={item} />
                    </div>
                  );
                })}
              </>
            )}
          </>
        )}

        {/* === ETFタブ === */}
        {tab === "etf" && (
          <>
            <div style={{ overflowX: "auto", display: "flex", gap: 6, paddingBottom: 8, marginBottom: 10 }}>
              {CATEGORIES.map(cat => (
                <button key={cat} onClick={() => { setCategory(cat); setScenario(null); }} style={{
                  flexShrink: 0, padding: "6px 12px", borderRadius: 20, border: "none",
                  background: category === cat ? "#0f172a" : "#e2e8f0",
                  color: category === cat ? "#fff" : "#475569",
                  fontSize: 12, fontWeight: 600, cursor: "pointer"
                }}>{cat}</button>
              ))}
            </div>
            {category === "金融政策シナリオ" && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                {SCENARIOS.map(sc => (
                  <button key={sc} onClick={() => setScenario(sc === scenario ? null : sc)} style={{
                    padding: "6px 12px", borderRadius: 20, border: "none",
                    background: scenario === sc ? "#3b82f6" : "#dbeafe",
                    color: scenario === sc ? "#fff" : "#1d4ed8",
                    fontSize: 12, fontWeight: 600, cursor: "pointer"
                  }}>{sc}</button>
                ))}
              </div>
            )}
            {scenario && (
              <div style={{
                background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 10,
                padding: "8px 12px", marginBottom: 10, fontSize: 12, color: "#1d4ed8"
              }}>
                📌 <strong>{scenario}</strong>に有利なETFをスコア順に表示。緑枠は適合度70点以上。
              </div>
            )}
            {MOCK_ETF_LIST
              .filter(e => category === "すべて" || category === "金融政策シナリオ" || e.category === category)
              .sort((a, b) => scenario ? (b.scenario || 0) - (a.scenario || 0) : 0)
              .map((etf, i) => <ETFCard key={i} etf={etf} showScenario={!!scenario} />)
            }
          </>
        )}

        {/* === チャットタブ === */}
        {tab === "chat" && (
          <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 180px)" }}>
            <div style={{ flex: 1, overflowY: "auto", paddingBottom: 12 }}>
              {messages.map((m, i) => (
                <div key={i} style={{
                  display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start",
                  marginBottom: 10
                }}>
                  <div style={{
                    maxWidth: "82%", padding: "10px 14px",
                    borderRadius: m.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                    background: m.role === "user" ? "#0f172a" : "#fff",
                    color: m.role === "user" ? "#fff" : "#1e293b",
                    fontSize: 13, lineHeight: 1.6, boxShadow: "0 1px 4px #0001"
                  }}>{m.text}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, background: "#fff", padding: "10px 12px", borderRadius: 14, boxShadow: "0 1px 8px #0002" }}>
              <input
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && sendChat()}
                placeholder="「AAPLを追加して」「SOUNを削除して」"
                style={{ flex: 1, border: "none", outline: "none", fontSize: 13, background: "transparent", color: "#1e293b" }}
              />
              <button onClick={sendChat} style={{
                background: "#0f172a", color: "#fff", border: "none",
                borderRadius: 10, padding: "6px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer"
              }}>送信</button>
            </div>
          </div>
        )}
      </div>

      {/* ボトムナビ */}
      <div style={{
        position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
        width: "100%", maxWidth: 430,
        background: "#fff", borderTop: "1px solid #e2e8f0",
        display: "flex", zIndex: 100
      }}>
        {TAB_ITEMS.map(t => (
          <button key={t.id} onClick={() => { setTab(t.id); setSelectedMoat(null); }} style={{
            flex: 1, padding: "10px 0 12px", border: "none", cursor: "pointer",
            background: "none",
            color: tab === t.id ? "#0f172a" : "#94a3b8",
            borderTop: tab === t.id ? "2px solid #0f172a" : "2px solid transparent",
            fontSize: 10, fontWeight: tab === t.id ? 700 : 500,
            display: "flex", flexDirection: "column", alignItems: "center", gap: 2
          }}>
            <span style={{ fontSize: 18 }}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* 免責事項 */}
      <div style={{
        position: "fixed", bottom: 64, left: "50%", transform: "translateX(-50%)",
        width: "100%", maxWidth: 430, background: "#1e293b",
        padding: "6px 14px", fontSize: 10, color: "#64748b", textAlign: "center"
      }}>
        ※ 本アプリの情報は投資助言ではありません。投資判断はご自身の責任で行ってください。
      </div>
    </div>
  );
}
