const { onRequest } = require("firebase-functions/https");
const logger = require("firebase-functions/logger");
const {
  axios,
  NAVER_CLIENT_ID,
  NAVER_CLIENT_SECRET,
  ECOS_API_KEY,
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

// ── 환율 조회 ─────────────────────────────────────────────
// ECOS 731Y001 통계항목코드. 잘못된 코드는 fetchEcos에서 빈 결과로 떨어져
// Promise.allSettled가 자동으로 제외하므로 안전.
const EXCHANGE_ITEM_MAP = {
  "0000001": { cur_unit: "USD", cur_nm: "미국 달러" },
  "0000002": { cur_unit: "JPY(100)", cur_nm: "일본 엔(100)" },
  "0000003": { cur_unit: "EUR", cur_nm: "유럽 유로" },
  "0000053": { cur_unit: "CNH", cur_nm: "중국 위안" },
  "0000005": { cur_unit: "GBP", cur_nm: "영국 파운드" },
  "0000006": { cur_unit: "CAD", cur_nm: "캐나다 달러" },
  "0000020": { cur_unit: "AUD", cur_nm: "호주 달러" },
  "0000027": { cur_unit: "HKD", cur_nm: "홍콩 달러" },
};

async function fetchExchangeRate() {
  if (!ECOS_API_KEY) {
    const today = new Date().toISOString().slice(0, 10);
    return [
      { cur_unit: "USD", cur_nm: "미국 달러", deal_bas_r: "1,350.00", date: today },
      { cur_unit: "EUR", cur_nm: "유럽 유로", deal_bas_r: "1,480.00", date: today },
      { cur_unit: "JPY(100)", cur_nm: "일본 엔(100)", deal_bas_r: "920.00", date: today },
      { cur_unit: "CNH", cur_nm: "중국 위안", deal_bas_r: "190.00", date: today },
      { cur_unit: "GBP", cur_nm: "영국 파운드", deal_bas_r: "1,710.00", date: today },
      { cur_unit: "CAD", cur_nm: "캐나다 달러", deal_bas_r: "990.00", date: today },
      { cur_unit: "AUD", cur_nm: "호주 달러", deal_bas_r: "880.00", date: today },
      { cur_unit: "HKD", cur_nm: "홍콩 달러", deal_bas_r: "172.00", date: today },
    ];
  }

  const itemCodes = Object.keys(EXCHANGE_ITEM_MAP);
  const results = await Promise.allSettled(
    itemCodes.map(async (code) => {
      const rows = await fetchEcos("731Y001", code, 14);
      if (rows.length === 0) return null;
      const latest = rows[rows.length - 1];
      return {
        ...EXCHANGE_ITEM_MAP[code],
        deal_bas_r: parseFloat(latest.DATA_VALUE).toFixed(2),
        date: latest.TIME,
      };
    })
  );

  return results
    .filter((r) => r.status === "fulfilled" && r.value)
    .map((r) => r.value);
}

// ── Yahoo Finance 단일 종목 조회 (재사용) ─────────────────
async function fetchYahooStock({ name, ticker, region }) {
  const res = await axios.get(
    `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`,
    { params: { interval: "1d", range: "1mo" } }
  );
  const chart = res.data.chart.result[0];
  const timestamps = chart.timestamp;
  const closes = chart.indicators.quote[0].close;
  const currentPrice = closes[closes.length - 1];
  const prevPrice = closes[closes.length - 2];
  const change = (((currentPrice - prevPrice) / prevPrice) * 100).toFixed(2);

  return {
    name,
    ticker,
    region: region || null,
    price: Math.round(currentPrice).toLocaleString(),
    price_raw: currentPrice,
    change: `${change > 0 ? "+" : ""}${change}%`,
    change_raw: parseFloat(change),
    chart: timestamps.map((t, i) => ({
      date: new Date(t * 1000).toISOString().slice(0, 10),
      close: Math.round(closes[i]),
    })),
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
// category 없으면 전체 반환 (주식은 국내만)
exports.getNews = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).send("");

  try {
    const { category, region } = req.query;
    const result = {};
    const fetchAll = !category;

    if (fetchAll || category === "주요지수") result.major_indices = await fetchMajorIndices();
    if (fetchAll || category === "주식") result.stocks = await fetchStockChart(region || "국내");
    if (fetchAll || category === "상승TOP5") result.top_gainers = await fetchTopGainers();
    if (fetchAll || category === "환율") result.exchange_rate = await fetchExchangeRate();
    if (fetchAll || category === "경제뉴스") result.news = await fetchEconomyNews("경제");
    if (fetchAll || category === "금리") result.interest_rate = await fetchInterestRate();

    return res.status(200).json(result);
  } catch (err) {
    logger.error("getNews error:", err);
    return res.status(500).json({ error: "뉴스 조회 실패" });
  }
});
