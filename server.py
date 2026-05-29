"""FastAPI: yfinance リアルタイムデータ API + React 静的ファイル配信."""
from __future__ import annotations

import logging
import os
import time
from datetime import datetime
from pathlib import Path

import requests as _requests
import uvicorn
import yfinance as yf
from deep_translator import GoogleTranslator
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="ETF Screener API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

# TTL キャッシュ: テクニカル 5分 / ファンダメンタルズ 1時間
_CACHE: dict[str, tuple[dict, float]] = {}
_CACHE_TTL = 300

_MOAT_CACHE: dict[str, tuple[dict, float]] = {}
_MOAT_TTL = 3600


# ── Yahoo Finance 直接 HTTP（crumb ベース）────────────────────────────
_YF_SESSION: _requests.Session | None = None
_YF_CRUMB: str | None = None
_YF_SESSION_TS: float = 0.0
_YF_SESSION_TTL: float = 1800.0   # 30分ごとに crumb を再取得


def _ensure_yf_session() -> tuple[_requests.Session, str | None]:
    """Yahoo Finance の crumb + Cookie を取得してキャッシュする。"""
    global _YF_SESSION, _YF_CRUMB, _YF_SESSION_TS
    if _YF_SESSION and _YF_CRUMB and time.monotonic() - _YF_SESSION_TS < _YF_SESSION_TTL:
        return _YF_SESSION, _YF_CRUMB

    s = _requests.Session()
    s.headers.update({
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept-Language": "en-US,en;q=0.9",
    })
    crumb = None
    try:
        s.get("https://finance.yahoo.com/", timeout=10)
        r = s.get("https://query1.finance.yahoo.com/v1/test/getcrumb", timeout=10)
        if r.status_code == 200 and r.text.strip():
            crumb = r.text.strip()
            logger.info("Yahoo Finance crumb 取得成功: %s…", crumb[:8])
        else:
            logger.warning("crumb 取得失敗: status=%s body=%r", r.status_code, r.text[:60])
    except Exception as e:
        logger.warning("Yahoo Finance セッション初期化失敗: %s", e)

    _YF_SESSION, _YF_CRUMB, _YF_SESSION_TS = s, crumb, time.monotonic()
    return s, crumb


def _fetch_fundamentals(ticker: str) -> dict:
    """quoteSummary を直接 HTTP で取得（yfinance の session 問題を回避）。"""
    s, crumb = _ensure_yf_session()
    if not crumb:
        return {}
    try:
        url = f"https://query1.finance.yahoo.com/v10/finance/quoteSummary/{ticker}"
        r = s.get(url, params={
            "modules": "financialData,defaultKeyStatistics,assetProfile",
            "crumb": crumb,
        }, timeout=15)
        if r.status_code != 200:
            logger.warning("%s: quoteSummary status=%s", ticker, r.status_code)
            return {}
        res = (r.json().get("quoteSummary") or {}).get("result") or []
        if not res:
            return {}
        fd = res[0].get("financialData") or {}
        ks = res[0].get("defaultKeyStatistics") or {}
        ap = res[0].get("assetProfile") or {}

        def _raw(d: dict, k: str):
            v = d.get(k)
            return v.get("raw") if isinstance(v, dict) else v

        return {
            "grossMargins":        _raw(fd, "grossMargins"),
            "revenueGrowth":       _raw(fd, "revenueGrowth"),
            "operatingMargins":    _raw(fd, "operatingMargins"),
            "recommendationMean":  _raw(fd, "recommendationMean"),
            "shortPercentOfFloat": _raw(ks, "shortPercentOfFloat"),
            "returnOnEquity":      _raw(fd, "returnOnEquity"),
            "longName":            ap.get("longName"),
            "shortName":           ap.get("shortName"),
            "industry":            ap.get("industry"),
            "sector":              ap.get("sector"),
        }
    except Exception as e:
        logger.warning("%s: _fetch_fundamentals 失敗: %s", ticker, e)
        return {}


def _translate_ja(text: str) -> str:
    """英語テキストを日本語に翻訳する。失敗時は原文を返す。"""
    if not text:
        return text
    try:
        return GoogleTranslator(source="auto", target="ja").translate(text) or text
    except Exception:
        return text


def _cached(ticker: str) -> dict | None:
    entry = _CACHE.get(ticker)
    if entry and time.monotonic() - entry[1] < _CACHE_TTL:
        return entry[0]
    return None


def _rsi(closes: list[float], period: int = 14) -> float | None:
    if len(closes) < period + 1:
        return None
    deltas = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    tail = deltas[-period:]
    avg_gain = sum(max(d, 0) for d in tail) / period
    avg_loss = sum(abs(min(d, 0)) for d in tail) / period
    if avg_loss == 0:
        return 100.0
    return round(100 - 100 / (1 + avg_gain / avg_loss), 1)


def _tr(highs: list, lows: list, closes: list, i: int) -> float:
    return max(
        highs[i] - lows[i],
        abs(highs[i] - closes[i - 1]),
        abs(lows[i] - closes[i - 1]),
    )


def _mean_atr(highs, lows, closes, start: int, end: int) -> float | None:
    trs = [_tr(highs, lows, closes, i) for i in range(start, end) if i > 0]
    return sum(trs) / len(trs) if trs else None


@app.get("/api/quote/{ticker}")
async def get_quote(ticker: str):
    ticker = ticker.upper().strip()
    if cached := _cached(ticker):
        return cached

    try:
        t = yf.Ticker(ticker)
        hist = t.history(period="3mo", auto_adjust=True)

        if hist.empty or len(hist) < 26:
            return {"ticker": ticker, "signal": "loading", "error": "データ不足"}

        closes = hist["Close"].tolist()
        highs = hist["High"].tolist()
        lows = hist["Low"].tolist()
        volumes = hist["Volume"].tolist()
        n = len(closes)

        price = round(closes[-1], 2)
        change = round((closes[-1] - closes[-2]) / closes[-2] * 100, 2)
        ma25 = round(sum(closes[-25:]) / 25, 2)
        rsi = _rsi(closes[-15:])

        # ATR比率: 直近14日 ÷ 過去30日ベースライン
        atr14 = _mean_atr(highs, lows, closes, max(1, n - 14), n)
        baseline = _mean_atr(highs, lows, closes, max(1, n - 44), max(1, n - 14))
        if atr14 and baseline and baseline > 0:
            atr_ratio = round(atr14 / baseline, 2)
        else:
            atr_ratio = 1.0

        # 出来高比: 本日 ÷ 直近20日平均
        avg_vol20 = sum(volumes[-21:-1]) / 20 if len(volumes) >= 21 else None
        vol_ratio = round(volumes[-1] / avg_vol20, 2) if avg_vol20 else 1.0

        rsi_ok = rsi is not None and 30 <= rsi <= 75
        atr_ok = atr_ratio <= 1.5
        vol_ok = vol_ratio >= 1.0
        above_ma = price > ma25

        if above_ma and rsi_ok and atr_ok and vol_ok:
            signal = "entry"
        elif above_ma:
            signal = "entry_fail"
        elif not above_ma:
            signal = "ma_exit"
        else:
            signal = "hold"

        currency = "JPY" if ticker.endswith(".T") else "USD"
        name = ticker
        try:
            info = t.get_info() if hasattr(t, "get_info") else t.info
            currency = info.get("currency") or currency
            name = info.get("longName") or info.get("shortName") or ticker
        except Exception:
            pass

        data = {
            "ticker": ticker,
            "name": name,
            "currency": currency,
            "price": price,
            "change": change,
            "ma25": ma25,
            "rsi": rsi,
            "atrRatio": atr_ratio,
            "volRatio": vol_ratio,
            "signal": signal,
            "filters": {"rsi": rsi_ok, "atr": atr_ok, "vol": vol_ok},
            "updated": datetime.now().strftime("%H:%M"),
            "error": None,
        }
        _CACHE[ticker] = (data, time.monotonic())
        return data

    except Exception:
        logger.exception("%s: 取得エラー", ticker)
        return {"ticker": ticker, "signal": "loading", "error": "取得失敗"}


@app.get("/api/moat/{ticker}")
async def get_moat(ticker: str):
    """ファンダメンタルズから堀の侵食度・信号・ニュースを返す (TTL 1時間)."""
    ticker = ticker.upper().strip()
    if cached := _MOAT_CACHE.get(ticker):
        if time.monotonic() - cached[1] < _MOAT_TTL:
            return cached[0]

    try:
        t = yf.Ticker(ticker)

        # ── Step1: yfinance t.info ────────────────────────────────────
        info: dict = {}
        try:
            raw = t.get_info() if hasattr(t, "get_info") else t.info
            if isinstance(raw, dict) and raw.get("grossMargins") is not None:
                info = raw
                logger.info("%s: t.info 成功", ticker)
        except Exception as e:
            logger.warning("%s: t.info 失敗 (%s)", ticker, e)

        # ── Step2: info に財務データがなければ直接 HTTP で取得 ───────────
        if not info.get("grossMargins") and not info.get("revenueGrowth"):
            logger.info("%s: info 空 → _fetch_fundamentals にフォールバック", ticker)
            direct = _fetch_fundamentals(ticker)
            if direct.get("grossMargins") is not None:
                info = direct
                logger.info("%s: _fetch_fundamentals 成功", ticker)

        gross_margin = float(info.get("grossMargins")        or 0)
        rev_growth   = float(info.get("revenueGrowth")       or 0)
        op_margin    = float(info.get("operatingMargins")    or 0)
        rec          = float(info.get("recommendationMean")  or 0) or 3.0
        short_pct    = float(info.get("shortPercentOfFloat") or 0)
        roe          = float(info.get("returnOnEquity")      or 0)

        # 侵食度スコア (0–100) + 内訳
        erosion = 0
        breakdown = []

        if gross_margin < 0.2:
            erosion += 20
            breakdown.append({"factor": "粗利率", "points": 20, "status": "red",
                               "detail": f"{round(gross_margin*100,1)}% — 参入障壁が低い可能性。競合に価格競争で負けるリスク。"})
        elif gross_margin < 0.4:
            erosion += 10
            breakdown.append({"factor": "粗利率", "points": 10, "status": "yellow",
                               "detail": f"{round(gross_margin*100,1)}% — やや低水準。競合圧力が徐々に拡大している可能性。"})
        else:
            breakdown.append({"factor": "粗利率", "points": 0, "status": "green",
                               "detail": f"{round(gross_margin*100,1)}% — 高い参入障壁を維持。価格支配力あり。"})

        if rev_growth < -0.05:
            erosion += 25
            breakdown.append({"factor": "売上成長", "points": 25, "status": "red",
                               "detail": f"{round(rev_growth*100,1)}% — 市場シェア喪失か需要縮小。堀が崩れている可能性が高い。"})
        elif rev_growth < 0.05:
            erosion += 10
            breakdown.append({"factor": "売上成長", "points": 10, "status": "yellow",
                               "detail": f"{round(rev_growth*100,1)}% — 成長鈍化。競合の追い上げに注意。"})
        else:
            breakdown.append({"factor": "売上成長", "points": 0, "status": "green",
                               "detail": f"+{round(rev_growth*100,1)}% — 成長継続。堀が拡大中。"})

        if op_margin < -0.2:
            erosion += 20
            breakdown.append({"factor": "営業利益率", "points": 20, "status": "red",
                               "detail": f"{round(op_margin*100,1)}% — 収益性に深刻な問題。資金調達リスクあり。"})
        elif op_margin < 0:
            erosion += 10
            breakdown.append({"factor": "営業利益率", "points": 10, "status": "yellow",
                               "detail": f"{round(op_margin*100,1)}% — 赤字体質。収益化の目処を確認すべき。"})
        else:
            breakdown.append({"factor": "営業利益率", "points": 0, "status": "green",
                               "detail": f"{round(op_margin*100,1)}% — 収益性良好。自己資金でシェア拡大が可能。"})

        if rec >= 3.5:
            erosion += 20
            breakdown.append({"factor": "アナリスト評価", "points": 20, "status": "red",
                               "detail": f"{round(rec,1)} / 5.0 — 売り推奨寄り。機関投資家がネガティブに転じている可能性。"})
        elif rec >= 2.5:
            erosion += 5
            breakdown.append({"factor": "アナリスト評価", "points": 5, "status": "yellow",
                               "detail": f"{round(rec,1)} / 5.0 — 中立。見通しが割れている状態。"})
        else:
            breakdown.append({"factor": "アナリスト評価", "points": 0, "status": "green",
                               "detail": f"{round(rec,1)} / 5.0 — 買い推奨多数。プロが堀の持続性を評価。"})

        if short_pct > 0.2:
            erosion += 15
            breakdown.append({"factor": "空売り比率", "points": 15, "status": "red",
                               "detail": f"{round(short_pct*100,1)}% — 機関の売り圧力が強い。悪材料が先に織り込まれるリスク。"})
        elif short_pct > 0.1:
            erosion += 5
            breakdown.append({"factor": "空売り比率", "points": 5, "status": "yellow",
                               "detail": f"{round(short_pct*100,1)}% — やや注意。ネガティブな見方が増えつつある。"})
        else:
            breakdown.append({"factor": "空売り比率", "points": 0, "status": "green",
                               "detail": f"{round(short_pct*100,1)}% — 正常範囲。弱気筋の圧力は限定的。"})

        erosion = min(100, erosion)
        alert = "red" if erosion >= 60 else "yellow" if erosion >= 30 else "green"

        # ニュース複数件取得 + 会社名フィルタ + 日本語翻訳
        news_items = []
        try:
            articles = t.news or []
            company_name = info.get("longName") or info.get("shortName") or ticker
            # 関連度スコア: 会社名 or ティッカーを含む記事を優先
            keywords = [ticker.lower()]
            # 会社名の先頭2単語をキーワードとして追加 (例: "BigBear.ai" → ["bigbear.ai"])
            for word in company_name.lower().split()[:2]:
                clean = word.strip(".,")
                if len(clean) >= 4:
                    keywords.append(clean)

            def _relevance(article: dict) -> int:
                content = article.get("content") or {}
                title = (content.get("title") or article.get("title", "")).lower()
                return 0 if any(k in title for k in keywords) else 1

            # 関連度順に並べ替えて最大10件から5件取得
            sorted_articles = sorted(articles[:10], key=_relevance)
            for article in sorted_articles[:5]:
                content  = article.get("content") or {}
                title_en = content.get("title") or article.get("title", "")
                link     = content.get("canonicalUrl", {}).get("url", "") or article.get("link", "")
                pub      = content.get("provider", {}).get("displayName", "") or article.get("publisher", "")
                ts       = content.get("pubDate", "") or ""
                if title_en:
                    title_ja = _translate_ja(title_en)
                    news_items.append({
                        "title":     title_ja,
                        "titleEn":   title_en,
                        "publisher": pub,
                        "link":      link,
                        "pubDate":   ts,
                    })
        except Exception:
            pass

        # 堀の説明 (フォールバック: 業種)
        moat_fallback = info.get("industry") or info.get("sector") or ticker

        data = {
            "ticker":    ticker,
            "name":      info.get("longName") or info.get("shortName") or ticker,
            "moat":      moat_fallback,
            "alert":     alert,
            "erosion":   erosion,
            "news":      news_items[0]["title"] if news_items else "",
            "newsItems": news_items,
            "breakdown": breakdown,
            "metrics": {
                "grossMargin":     round(gross_margin * 100, 1) if gross_margin else None,
                "revenueGrowth":   round(rev_growth   * 100, 1) if rev_growth   else None,
                "operatingMargin": round(op_margin    * 100, 1) if op_margin    else None,
                "recommendation":  round(rec, 1),
                "shortPct":        round(short_pct    * 100, 1) if short_pct    else None,
                "roe":             round(roe           * 100, 1) if roe          else None,
            },
        }
        _MOAT_CACHE[ticker] = (data, time.monotonic())
        return data

    except Exception as e:
        logger.exception("%s: moat 取得エラー: %s", ticker, e)
        return {"ticker": ticker, "alert": "yellow", "erosion": None,
                "news": "取得失敗", "newsItems": [], "breakdown": [], "metrics": {}}


# React の dist を配信 (本番のみ)
_dist = Path(__file__).parent / "dist"
if _dist.exists():
    _NO_CACHE = {"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache"}

    @app.get("/", include_in_schema=False)
    @app.get("/index.html", include_in_schema=False)
    async def serve_index():
        """index.html は常に最新を返す（モバイルキャッシュ対策）。"""
        return FileResponse(str(_dist / "index.html"), headers=_NO_CACHE)

    app.mount("/", StaticFiles(directory=str(_dist), html=True), name="static")

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=False)
