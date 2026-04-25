const { onRequest } = require("firebase-functions/https");
const logger = require("firebase-functions/logger");
const {
  axios,
  NAVER_CLIENT_ID,
  NAVER_CLIENT_SECRET,
  KOREAEXIM_API_KEY,
  ECOS_API_KEY,
  setCorsHeaders,
} = require("./config");

// 주식 차트 조회할 대표 종목
const STOCK_TICKERS = [
  { name: "삼성전자", ticker: "005930.KS" },
  { name: "SK하이닉스", ticker: "000660.KS" },
  { name: "카카오", ticker: "035720.KS" },
  { name: "NAVER", ticker: "035420.KS" },
  { name: "현대차", ticker: "005380.KS" },
];

// 환율 조회 (한국수출입은행 API)
async function fetchExchangeRate() {
  if (!KOREAEXIM_API_KEY) {
    return [
      { cur_unit: "USD", cur_nm: "미국 달러", deal_bas_r: "1,350.00" },
      { cur_unit: "EUR", cur_nm: "유럽 유로", deal_bas_r: "1,480.00" },
      { cur_unit: "JPY(100)", cur_nm: "일본 엔", deal_bas_r: "920.00" },
      { cur_unit: "CNH", cur_nm: "중국 위안화", deal_bas_r: "190.00" },
    ];
  }

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const res = await axios.get("https://www.koreaexim.go.kr/site/program/financial/exchangeJSON", {
    params: { authkey: KOREAEXIM_API_KEY, searchdate: today, data: "AP01" },
  });

  return res.data
    .filter((r) => ["USD", "EUR", "JPY(100)", "CNH"].includes(r.cur_unit))
    .map((r) => ({ cur_unit: r.cur_unit, cur_nm: r.cur_nm, deal_bas_r: r.deal_bas_r }));
}

// 주식 차트 조회 (Yahoo Finance 비공식 API, 키 불필요)
async function fetchStockChart() {
  const results = await Promise.allSettled(
    STOCK_TICKERS.map(async ({ name, ticker }) => {
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
        price: Math.round(currentPrice).toLocaleString(),
        change: `${change > 0 ? "+" : ""}${change}%`,
        chart: timestamps.map((t, i) => ({
          date: new Date(t * 1000).toISOString().slice(0, 10),
          close: Math.round(closes[i]),
        })),
      };
    })
  );

  return results
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value);
}

// 경제뉴스 조회 (네이버 뉴스 API)
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

// 금리 조회 (한국은행 ECOS API)
async function fetchInterestRate() {
  if (!ECOS_API_KEY) {
    return {
      base_rate: "3.50",
      date: new Date().toISOString().slice(0, 10),
      description: "한국은행 기준금리",
    };
  }

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const threeMonthsAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10).replace(/-/g, "");

  const res = await axios.get(
    `https://ecos.bok.or.kr/api/StatisticSearch/${ECOS_API_KEY}/json/kr/1/5/722Y001/DD/${threeMonthsAgo}/${today}/0101000`
  );

  const rows = res.data.StatisticSearch.row;
  const latest = rows[rows.length - 1];

  return {
    base_rate: latest.DATA_VALUE,
    date: latest.TIME,
    description: "한국은행 기준금리",
  };
}

// 금융 뉴스 통합 조회
// GET /getNews?category=환율|주식|경제뉴스|금리
// category 없으면 전체 반환
exports.getNews = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).send("");

  try {
    const { category } = req.query;
    const result = {};
    const fetchAll = !category;

    if (fetchAll || category === "환율") result.exchange_rate = await fetchExchangeRate();
    if (fetchAll || category === "주식") result.stocks = await fetchStockChart();
    if (fetchAll || category === "경제뉴스") result.news = await fetchEconomyNews("경제");
    if (fetchAll || category === "금리") result.interest_rate = await fetchInterestRate();

    return res.status(200).json(result);
  } catch (err) {
    logger.error("getNews error:", err);
    return res.status(500).json({ error: "뉴스 조회 실패" });
  }
});
