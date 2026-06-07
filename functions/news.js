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
const { stockLogoUrl } = require("./logos");

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

// 국내 인기 종목 (코스피 시총 상위 10)
const DOMESTIC_STOCKS = [
  { name: "삼성전자", ticker: "005930.KS" },
  { name: "SK하이닉스", ticker: "000660.KS" },
  { name: "LG에너지솔루션", ticker: "373220.KS" },
  { name: "삼성바이오로직스", ticker: "207940.KS" },
  { name: "현대차", ticker: "005380.KS" },
  { name: "기아", ticker: "000270.KS" },
  { name: "NAVER", ticker: "035420.KS" },
  { name: "카카오", ticker: "035720.KS" },
  { name: "POSCO홀딩스", ticker: "005490.KS" },
  { name: "셀트리온", ticker: "068270.KS" },
];

// 해외 인기 종목 (미국 빅테크 + 시총 상위 10)
const OVERSEAS_STOCKS = [
  { name: "애플", ticker: "AAPL" },
  { name: "마이크로소프트", ticker: "MSFT" },
  { name: "엔비디아", ticker: "NVDA" },
  { name: "구글", ticker: "GOOGL" },
  { name: "아마존", ticker: "AMZN" },
  { name: "메타", ticker: "META" },
  { name: "테슬라", ticker: "TSLA" },
  { name: "넷플릭스", ticker: "NFLX" },
  { name: "AMD", ticker: "AMD" },
  { name: "인텔", ticker: "INTC" },
];

// 상승 TOP 5 계산용 종목 풀 (국내 25 + 해외 25 = 50개)
const TOP_GAINERS_POOL = [
  // ── 국내 (25개, 코스피 시총 상위 위주) ──
  { name: "삼성전자", ticker: "005930.KS" },
  { name: "SK하이닉스", ticker: "000660.KS" },
  { name: "LG에너지솔루션", ticker: "373220.KS" },
  { name: "삼성바이오로직스", ticker: "207940.KS" },
  { name: "현대차", ticker: "005380.KS" },
  { name: "기아", ticker: "000270.KS" },
  { name: "NAVER", ticker: "035420.KS" },
  { name: "카카오", ticker: "035720.KS" },
  { name: "POSCO홀딩스", ticker: "005490.KS" },
  { name: "LG화학", ticker: "051910.KS" },
  { name: "셀트리온", ticker: "068270.KS" },
  { name: "KB금융", ticker: "105560.KS" },
  { name: "신한지주", ticker: "055550.KS" },
  { name: "삼성SDI", ticker: "006400.KS" },
  { name: "현대모비스", ticker: "012330.KS" },
  { name: "하나금융지주", ticker: "086790.KS" },
  { name: "우리금융지주", ticker: "316140.KS" },
  { name: "메리츠금융지주", ticker: "138040.KS" },
  { name: "삼성생명", ticker: "032830.KS" },
  { name: "한화에어로스페이스", ticker: "012450.KS" },
  { name: "두산에너빌리티", ticker: "034020.KS" },
  { name: "한국전력", ticker: "015760.KS" },
  { name: "삼성물산", ticker: "028260.KS" },
  { name: "SK이노베이션", ticker: "096770.KS" },
  { name: "LG전자", ticker: "066570.KS" },
  // ── 해외 (25개, S&P500/나스닥 시총 상위) ──
  { name: "애플", ticker: "AAPL" },
  { name: "마이크로소프트", ticker: "MSFT" },
  { name: "엔비디아", ticker: "NVDA" },
  { name: "구글", ticker: "GOOGL" },
  { name: "아마존", ticker: "AMZN" },
  { name: "메타", ticker: "META" },
  { name: "테슬라", ticker: "TSLA" },
  { name: "넷플릭스", ticker: "NFLX" },
  { name: "AMD", ticker: "AMD" },
  { name: "인텔", ticker: "INTC" },
  { name: "디즈니", ticker: "DIS" },
  { name: "코카콜라", ticker: "KO" },
  { name: "맥도날드", ticker: "MCD" },
  { name: "JP모건", ticker: "JPM" },
  { name: "버크셔해서웨이", ticker: "BRK-B" },
  { name: "비자", ticker: "V" },
  { name: "마스터카드", ticker: "MA" },
  { name: "월마트", ticker: "WMT" },
  { name: "P&G", ticker: "PG" },
  { name: "유나이티드헬스", ticker: "UNH" },
  { name: "존슨앤존슨", ticker: "JNJ" },
  { name: "엑손모빌", ticker: "XOM" },
  { name: "셰브론", ticker: "CVX" },
  { name: "화이자", ticker: "PFE" },
  { name: "보잉", ticker: "BA" },
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

// KST(UTC+9) 기준 YYYYMMDD 문자열.
// Firebase Functions는 기본 UTC라 그냥 toISOString하면 한국 새벽엔 전날 날짜가 나옴.
function _dateYYYYMMDD(d) {
  const kstMs = d.getTime() + 9 * 60 * 60 * 1000;
  const kst = new Date(kstMs);
  return kst.toISOString().slice(0, 10).replace(/-/g, "");
}

// 환율 캐시 (5분 TTL) — 한국수출입은행 API는 영업일 1일 여러 번 갱신.
// 캐시 시간 짧게 두어 stale 데이터 위험 최소화.
const _exchangeCache = { data: null, expiresAt: 0 };
const EXCHANGE_CACHE_TTL_MS = 5 * 60 * 1000; // 5분

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
    logo_url: stockLogoUrl(ticker),
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
    return emptyResponse;
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
    logo_url: stockLogoUrl(ticker),
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
// 금융/경제 관련성 필터링 키워드 — 제목·본문에 하나라도 들어가면 통과.
const FINANCE_KEYWORDS = [
  "금리", "기준금리", "주식", "주가", "증시", "코스피", "코스닥", "나스닥",
  "환율", "원·달러", "원달러", "달러", "엔화", "위안화", "유로",
  "금융", "은행", "예금", "적금", "대출", "신용",
  "투자", "펀드", "ETF", "채권", "부동산",
  "경기", "물가", "인플레", "소비자물가", "GDP", "수출", "수입",
  "한은", "한국은행", "연준", "Fed", "금융위", "금감원",
  "원화", "엔저", "엔고", "달러강세", "달러약세",
];

function _isFinanceRelated(item) {
  const text = `${item.title} ${item.description}`;
  return FINANCE_KEYWORDS.some((k) => text.includes(k));
}

async function fetchEconomyNews(keyword = "경제") {
  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
    return [
      { title: "한국은행, 기준금리 동결 결정", link: "#", pubDate: new Date().toUTCString(), description: "한국은행 금융통화위원회가 기준금리를 현 수준에서 동결하기로 했다." },
      { title: "코스피, 외국인 매수에 상승 마감", link: "#", pubDate: new Date().toUTCString(), description: "코스피 지수가 외국인 순매수에 힘입어 상승 마감했다." },
      { title: "원·달러 환율 소폭 하락", link: "#", pubDate: new Date().toUTCString(), description: "원·달러 환율이 전 거래일 대비 소폭 하락했다." },
    ];
  }

  // 더 많이 가져와서 필터링 후 상위 10개만 반환 (display 최대 100).
  const res = await axios.get("https://openapi.naver.com/v1/search/news.json", {
    params: { query: keyword, display: 50, sort: "date" },
    headers: {
      "X-Naver-Client-Id": NAVER_CLIENT_ID,
      "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
    },
  });

  const cleaned = res.data.items.map((item) => ({
    title: item.title.replace(/<[^>]+>/g, ""),
    link: item.link,
    pubDate: item.pubDate,
    description: item.description.replace(/<[^>]+>/g, ""),
  }));

  // 사용자가 명시적 키워드를 줬으면 그대로 (해당 키워드 자체가 충분히 좁음).
  // 기본 "경제" 검색이면 금융 관련성 필터링 적용.
  const filtered = keyword === "경제"
    ? cleaned.filter(_isFinanceRelated)
    : cleaned;

  return filtered.slice(0, 10);
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
