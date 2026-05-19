const { onRequest } = require("firebase-functions/https");
const logger = require("firebase-functions/logger");
const {
  axios,
  NAVER_CLIENT_ID,
  NAVER_CLIENT_SECRET,
  ECOS_API_KEY,
  EXIM_API_KEY,
  setCorsHeaders,
} = require("./config");

// 한국은행 ECOS API 공통 호출 함수
async function fetchEcos(statCode, itemCode, days = 30) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10).replace(/-/g, "");

  const url = `https://ecos.bok.or.kr/api/StatisticSearch/${ECOS_API_KEY}/json/kr/1/100/${statCode}/D/${fromDate}/${today}/${itemCode}`;
  const res = await axios.get(url);

  if (!res.data.StatisticSearch) return [];
  return res.data.StatisticSearch.row || [];
}

// ── 주식 종목 정의 ─────────────────────────────────────────
// 주요 지수
const MAJOR_INDICES = [
  { name: "코스피", ticker: "^KS11", region: "국내" },
  { name: "코스닥", ticker: "^KQ11", region: "국내" },
  { name: "S&P 500", ticker: "^GSPC", region: "해외" },
  { name: "나스닥", ticker: "^IXIC", region: "해외" },
];

// 국내 인기 종목
const DOMESTIC_STOCKS = [
  { name: "삼성전자", ticker: "005930.KS" },
  { name: "SK하이닉스", ticker: "000660.KS" },
  { name: "카카오", ticker: "035720.KS" },
  { name: "NAVER", ticker: "035420.KS" },
  { name: "현대차", ticker: "005380.KS" },
];

// 해외 인기 종목
const OVERSEAS_STOCKS = [
  { name: "애플", ticker: "AAPL" },
  { name: "테슬라", ticker: "TSLA" },
  { name: "엔비디아", ticker: "NVDA" },
  { name: "마이크로소프트", ticker: "MSFT" },
  { name: "구글", ticker: "GOOGL" },
];

// 상승 TOP 5 계산용 종목 풀 (국내+해외 다양한 종목 30개)
const TOP_GAINERS_POOL = [
  // 국내 (15개)
  { name: "삼성전자", ticker: "005930.KS" },
  { name: "SK하이닉스", ticker: "000660.KS" },
  { name: "카카오", ticker: "035720.KS" },
  { name: "NAVER", ticker: "035420.KS" },
  { name: "현대차", ticker: "005380.KS" },
  { name: "LG에너지솔루션", ticker: "373220.KS" },
  { name: "삼성바이오로직스", ticker: "207940.KS" },
  { name: "기아", ticker: "000270.KS" },
  { name: "POSCO홀딩스", ticker: "005490.KS" },
  { name: "LG화학", ticker: "051910.KS" },
  { name: "셀트리온", ticker: "068270.KS" },
  { name: "KB금융", ticker: "105560.KS" },
  { name: "신한지주", ticker: "055550.KS" },
  { name: "삼성SDI", ticker: "006400.KS" },
  { name: "현대모비스", ticker: "012330.KS" },
  // 해외 (15개)
  { name: "애플", ticker: "AAPL" },
  { name: "테슬라", ticker: "TSLA" },
  { name: "엔비디아", ticker: "NVDA" },
  { name: "마이크로소프트", ticker: "MSFT" },
  { name: "구글", ticker: "GOOGL" },
  { name: "아마존", ticker: "AMZN" },
  { name: "메타", ticker: "META" },
  { name: "넷플릭스", ticker: "NFLX" },
  { name: "AMD", ticker: "AMD" },
  { name: "인텔", ticker: "INTC" },
  { name: "디즈니", ticker: "DIS" },
  { name: "코카콜라", ticker: "KO" },
  { name: "맥도날드", ticker: "MCD" },
  { name: "JP모건", ticker: "JPM" },
  { name: "버크셔해서웨이", ticker: "BRK-B" },
];

// ── 환율 조회 (한국수출입은행 API) ────────────────────────
// https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON
// 한 번 호출에 ~20개 통화. 응답 키: cur_unit, cur_nm, deal_bas_r 등.
// 휴장일/주말엔 빈 배열이 오므로 평일 N일 거슬러 시도.

// FE 노출 우선순위 — 주요국 + 한국인 자주 거래.
const EXCHANGE_PREFERRED_ORDER = [
  "USD", "EUR", "JPY", "JPY(100)", "CNH", "CNY",
  "GBP", "AUD", "CAD", "CHF", "HKD", "SGD",
  "NZD", "SEK", "NOK", "DKK", "THB",
];

// 한국어 라벨 보정 (API가 안 주거나 짧게 줄 때).
const KOREAN_CUR_NAMES = {
  USD: "미국 달러",
  EUR: "유럽 유로",
  JPY: "일본 엔",
  "JPY(100)": "일본 엔(100)",
  CNH: "중국 위안",
  CNY: "중국 위안",
  GBP: "영국 파운드",
  AUD: "호주 달러",
  CAD: "캐나다 달러",
  CHF: "스위스 프랑",
  HKD: "홍콩 달러",
  SGD: "싱가포르 달러",
  NZD: "뉴질랜드 달러",
  SEK: "스웨덴 크로나",
  NOK: "노르웨이 크로네",
  DKK: "덴마크 크로네",
  THB: "태국 바트",
};

function _exchangeMock() {
  const today = new Date().toISOString().slice(0, 10);
  return [
    { cur_unit: "USD", cur_nm: "미국 달러", deal_bas_r: "1,350.00", date: today },
    { cur_unit: "EUR", cur_nm: "유럽 유로", deal_bas_r: "1,480.00", date: today },
    { cur_unit: "JPY(100)", cur_nm: "일본 엔(100)", deal_bas_r: "920.00", date: today },
    { cur_unit: "CNH", cur_nm: "중국 위안", deal_bas_r: "190.00", date: today },
    { cur_unit: "GBP", cur_nm: "영국 파운드", deal_bas_r: "1,710.00", date: today },
    { cur_unit: "AUD", cur_nm: "호주 달러", deal_bas_r: "880.00", date: today },
    { cur_unit: "CAD", cur_nm: "캐나다 달러", deal_bas_r: "990.00", date: today },
    { cur_unit: "CHF", cur_nm: "스위스 프랑", deal_bas_r: "1,550.00", date: today },
    { cur_unit: "HKD", cur_nm: "홍콩 달러", deal_bas_r: "172.00", date: today },
    { cur_unit: "SGD", cur_nm: "싱가포르 달러", deal_bas_r: "1,020.00", date: today },
  ];
}

function _dateYYYYMMDD(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

// 환율 캐시 (1시간 TTL) — 한국수출입은행 API는 영업일 오전 11시 1회 갱신.
const _exchangeCache = { data: null, expiresAt: 0 };
const EXCHANGE_CACHE_TTL_MS = 60 * 60 * 1000; // 1시간

async function fetchExchangeRate() {
  // 캐시 hit
  if (_exchangeCache.data && Date.now() < _exchangeCache.expiresAt) {
    return _exchangeCache.data;
  }

  if (!EXIM_API_KEY) {
    return _exchangeMock();
  }

  // 최대 7일 거슬러 시도 (휴장일 회피).
  for (let i = 0; i < 7; i++) {
    const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const searchdate = _dateYYYYMMDD(date);
    try {
      const res = await axios.get(
        "https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON",
        {
          params: { authkey: EXIM_API_KEY, searchdate, data: "AP01" },
          timeout: 8000,
        }
      );
      const list = Array.isArray(res.data) ? res.data : [];
      if (list.length === 0) continue;

      const normalized = list
        .filter((r) => r && r.cur_unit && r.deal_bas_r)
        .map((r) => ({
          cur_unit: r.cur_unit,
          cur_nm: KOREAN_CUR_NAMES[r.cur_unit] || r.cur_nm || r.cur_unit,
          deal_bas_r: r.deal_bas_r, // 이미 콤마 포함 문자열
          date: searchdate,
        }));
      const score = (u) => {
        const idx = EXCHANGE_PREFERRED_ORDER.indexOf(u);
        return idx === -1 ? EXCHANGE_PREFERRED_ORDER.length : idx;
      };
      normalized.sort((a, b) => score(a.cur_unit) - score(b.cur_unit));

      // 캐시 저장
      _exchangeCache.data = normalized;
      _exchangeCache.expiresAt = Date.now() + EXCHANGE_CACHE_TTL_MS;
      return normalized;
    } catch (e) {
      logger.warn(`fetchExchangeRate(${searchdate}) 실패:`, e?.message || e);
    }
  }

  logger.warn("환율 API 실패 — mock으로 폴백");
  return _exchangeMock();
}

// ── Yahoo Finance 단일 종목 조회 (재사용) ─────────────────
async function fetchYahooStock({ name, ticker, region }) {
  const emptyResponse = {
    name,
    ticker,
    region: region || null,
    price: "-",
    price_raw: null,
    change: "",
    change_raw: 0,
    chart: [],
  };

  let res;
  try {
    res = await axios.get(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`,
      { params: { interval: "1d", range: "1mo" }, timeout: 8000 }
    );
  } catch (e) {
    logger.warn(`fetchYahooStock(${ticker}) 네트워크 실패:`, e?.message || e);
    return emptyResponse;
  }

  // 응답 구조 방어적 파싱
  const chart = res.data?.chart?.result?.[0];
  if (!chart) {
    logger.warn(`fetchYahooStock(${ticker}) 응답 구조 비정상`);
    return emptyResponse;
  }
  const timestamps = chart.timestamp || [];
  const closes = (chart.indicators?.quote?.[0]?.close) || [];

  // 장이 안 열린 날(주말/휴일)도 timestamp에 포함되지만 close는 null.
  // 마지막에서부터 거슬러 올라가며 null이 아닌 첫 close를 사용.
  let curIdx = closes.length - 1;
  while (curIdx >= 0 && closes[curIdx] == null) curIdx--;

  if (curIdx < 0) {
    // 데이터 전무.
    return {
      name,
      ticker,
      region: region || null,
      price: "-",
      price_raw: null,
      change: "",
      change_raw: 0,
      chart: [],
    };
  }

  const currentPrice = closes[curIdx];
  let prevIdx = curIdx - 1;
  while (prevIdx >= 0 && closes[prevIdx] == null) prevIdx--;
  const prevPrice = prevIdx >= 0 ? closes[prevIdx] : currentPrice;
  const change = prevPrice
    ? (((currentPrice - prevPrice) / prevPrice) * 100).toFixed(2)
    : "0.00";

  return {
    name,
    ticker,
    region: region || null,
    price: Math.round(currentPrice).toLocaleString(),
    price_raw: currentPrice,
    change: `${parseFloat(change) > 0 ? "+" : ""}${change}%`,
    change_raw: parseFloat(change),
    // null close는 차트에서 제외 (직선 끊김 방지).
    chart: timestamps
      .map((t, i) => closes[i] == null
          ? null
          : {
              date: new Date(t * 1000).toISOString().slice(0, 10),
              close: Math.round(closes[i]),
            })
      .filter((p) => p !== null),
  };
}

// ── 주요 지수 조회 ────────────────────────────────────────
async function fetchMajorIndices() {
  const results = await Promise.allSettled(
    MAJOR_INDICES.map((item) => fetchYahooStock(item))
  );
  return results
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value);
}

// ── 인기 종목 조회 (국내/해외) ────────────────────────────
async function fetchStockChart(region = "국내") {
  const stocks = region === "해외" ? OVERSEAS_STOCKS : DOMESTIC_STOCKS;
  const results = await Promise.allSettled(
    stocks.map((item) => fetchYahooStock({ ...item, region }))
  );
  return results
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value);
}

// ── 상승 TOP 5 (30개 종목 풀에서 등락률 정렬) ─────────────
async function fetchTopGainers() {
  const results = await Promise.allSettled(
    TOP_GAINERS_POOL.map((item) => fetchYahooStock(item))
  );

  return results
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value)
    .filter((s) => s.change_raw > 0)         // 상승 종목만
    .sort((a, b) => b.change_raw - a.change_raw)
    .slice(0, 5);
}

// ── 경제뉴스 조회 (네이버 뉴스 API) ───────────────────────
async function fetchEconomyNews(keyword = "경제") {
  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
    return [
      { title: "한국은행, 기준금리 동결 결정", link: "#", pubDate: new Date().toUTCString(), description: "한국은행 금융통화위원회가 기준금리를 현 수준에서 동결하기로 했다." },
      { title: "코스피, 외국인 매수에 상승 마감", link: "#", pubDate: new Date().toUTCString(), description: "코스피 지수가 외국인 순매수에 힘입어 상승 마감했다." },
      { title: "원·달러 환율 소폭 하락", link: "#", pubDate: new Date().toUTCString(), description: "원·달러 환율이 전 거래일 대비 소폭 하락했다." },
    ];
  }

  const res = await axios.get("https://openapi.naver.com/v1/search/news.json", {
    params: { query: keyword, display: 10, sort: "date" },
    headers: {
      "X-Naver-Client-Id": NAVER_CLIENT_ID,
      "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
    },
  });

  return res.data.items.map((item) => ({
    title: item.title.replace(/<[^>]+>/g, ""),
    link: item.link,
    pubDate: item.pubDate,
    description: item.description.replace(/<[^>]+>/g, ""),
  }));
}

// ── 금리 조회 ─────────────────────────────────────────────
async function fetchInterestRate() {
  if (!ECOS_API_KEY) {
    return {
      base_rate: "3.50",
      date: new Date().toISOString().slice(0, 10),
      description: "한국은행 기준금리",
    };
  }

  const rows = await fetchEcos("722Y001", "0101000", 90);
  const latest = rows[rows.length - 1];

  return {
    base_rate: latest.DATA_VALUE,
    date: latest.TIME,
    description: "한국은행 기준금리",
  };
}

// ── 금융 뉴스 통합 조회 ──────────────────────────────────
// GET /getNews?category=환율|주식|경제뉴스|금리|주요지수|상승TOP5
// GET /getNews?category=주식&region=국내|해외
// GET /getNews?category=경제뉴스&keyword=금리
// category 없으면 전체 반환 (주식은 국내만)
exports.getNews = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).send("");

  try {
    const { category, region, keyword } = req.query;
    const result = {};
    const fetchAll = !category;
    const newsKeyword = (typeof keyword === "string" && keyword.trim().length > 0)
      ? keyword.trim()
      : "경제";

    if (fetchAll || category === "주요지수") result.major_indices = await fetchMajorIndices();
    if (fetchAll || category === "주식") result.stocks = await fetchStockChart(region || "국내");
    if (fetchAll || category === "상승TOP5") result.top_gainers = await fetchTopGainers();
    if (fetchAll || category === "환율") result.exchange_rate = await fetchExchangeRate();
    if (fetchAll || category === "경제뉴스") result.news = await fetchEconomyNews(newsKeyword);
    if (fetchAll || category === "금리") result.interest_rate = await fetchInterestRate();

    return res.status(200).json(result);
  } catch (err) {
    logger.error("getNews error:", err);
    return res.status(500).json({ error: "뉴스 조회 실패" });
  }
});

// ── 통합 검색 ─────────────────────────────────────────────
// GET /searchAll?keyword=삼성
// 종목(주요지수+국내+해외) + 환율 + 뉴스를 한 번에 검색.
exports.searchAll = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).send("");

  try {
    const { keyword } = req.query;
    if (!keyword || typeof keyword !== "string" || keyword.trim().length === 0) {
      return res.status(400).json({ error: "keyword 필수" });
    }
    const q = keyword.trim();
    const qLower = q.toLowerCase();

    // 1. 종목 후보 (가벼운 이름+티커 매칭, 차트 안 가져옴 — 빠름).
    const allStockDefs = [
      ...MAJOR_INDICES,
      ...DOMESTIC_STOCKS.map((s) => ({ ...s, region: "국내" })),
      ...OVERSEAS_STOCKS.map((s) => ({ ...s, region: "해외" })),
    ];
    const stockMatches = allStockDefs.filter(
      (s) =>
        s.name.toLowerCase().includes(qLower) ||
        s.ticker.toLowerCase().includes(qLower),
    );

    // 매칭된 종목만 실제 가격 조회 (최대 10개).
    const stockResults = await Promise.allSettled(
      stockMatches.slice(0, 10).map((item) => fetchYahooStock(item)),
    );
    const stocks = stockResults
      .filter((r) => r.status === "fulfilled")
      .map((r) => r.value);

    // 2. 환율 후보 — 캐시 활용.
    const allExchange = await fetchExchangeRate();
    const exchange = allExchange.filter(
      (e) =>
        (e.cur_unit && e.cur_unit.toLowerCase().includes(qLower)) ||
        (e.cur_nm && e.cur_nm.toLowerCase().includes(qLower)),
    );

    // 3. 뉴스 — 키워드 그대로 네이버 API 호출.
    const news = await fetchEconomyNews(q);

    return res.status(200).json({
      keyword: q,
      stocks,
      exchange,
      news,
    });
  } catch (err) {
    logger.error("searchAll error:", err);
    return res.status(500).json({ error: "검색 실패" });
  }
});
