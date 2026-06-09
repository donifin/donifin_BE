// 로고 URL 매핑.
// Clearbit Logo API 사용 (무료, 키 불필요): https://logo.clearbit.com/<domain>
// 매핑 안 된 항목은 null 반환 → FE가 폴백 위젯 표시.

const CLEARBIT_BASE = "https://logo.clearbit.com";

// ── 주식 종목 → 도메인 매핑 ─────────────────────────────────
const STOCK_DOMAIN_MAP = {
  // 국내
  "005930.KS": "samsung.com",          // 삼성전자
  "000660.KS": "skhynix.com",          // SK하이닉스
  "035720.KS": "kakaocorp.com",        // 카카오
  "035420.KS": "navercorp.com",        // NAVER
  "005380.KS": "hyundai.com",          // 현대차
  "373220.KS": "lgensol.com",          // LG에너지솔루션
  "207940.KS": "samsungbiologics.com", // 삼성바이오로직스
  "000270.KS": "kia.com",              // 기아
  "005490.KS": "posco.com",            // POSCO홀딩스
  "051910.KS": "lgchem.com",           // LG화학
  "068270.KS": "celltrion.com",        // 셀트리온
  "105560.KS": "kbfg.com",             // KB금융
  "055550.KS": "shinhangroup.com",     // 신한지주
  "006400.KS": "samsungsdi.com",       // 삼성SDI
  "012330.KS": "mobis.co.kr",          // 현대모비스

  // 국내 (추가)
  "086790.KS": "hanafn.com",            // 하나금융지주
  "316140.KS": "woorifg.com",           // 우리금융지주
  "138040.KS": "meritz.co.kr",          // 메리츠금융지주
  "032830.KS": "samsunglife.com",       // 삼성생명
  "012450.KS": "hanwhaaerospace.co.kr", // 한화에어로스페이스
  "034020.KS": "doosanenerbility.com",  // 두산에너빌리티
  "015760.KS": "kepco.co.kr",           // 한국전력
  "028260.KS": "samsungcnt.com",        // 삼성물산
  "096770.KS": "skinnovation.com",      // SK이노베이션
  "066570.KS": "lge.com",               // LG전자

  // 해외
  "AAPL": "apple.com",
  "TSLA": "tesla.com",
  "NVDA": "nvidia.com",
  "MSFT": "microsoft.com",
  "GOOGL": "google.com",
  "AMZN": "amazon.com",
  "META": "meta.com",
  "NFLX": "netflix.com",
  "AMD": "amd.com",
  "INTC": "intel.com",
  "DIS": "disney.com",
  "KO": "coca-cola.com",
  "MCD": "mcdonalds.com",
  "JPM": "jpmorganchase.com",
  "BRK-B": "berkshirehathaway.com",

  // 해외 (추가)
  "V": "visa.com",
  "MA": "mastercard.com",
  "WMT": "walmart.com",
  "PG": "pg.com",
  "UNH": "unitedhealthgroup.com",
  "JNJ": "jnj.com",
  "XOM": "exxonmobil.com",
  "CVX": "chevron.com",
  "PFE": "pfizer.com",
  "BA": "boeing.com",
};

// ── 은행/금융사 → 도메인 매핑 ───────────────────────────────
// FSS API의 kor_co_nm 값을 키로 사용. 정규화 후 lookup.
const BANK_DOMAIN_MAP = {
  // 시중은행
  "국민은행": "kbstar.com",
  "신한은행": "shinhan.com",
  "하나은행": "hanabank.com",
  "우리은행": "wooribank.com",
  "농협은행": "nonghyup.com",
  "기업은행": "ibk.co.kr",
  "한국씨티은행": "citibank.co.kr",
  "한국스탠다드차타드은행": "standardchartered.co.kr",
  "SC제일은행": "standardchartered.co.kr",

  // 인터넷전문은행
  "카카오뱅크": "kakaobank.com",
  "케이뱅크": "kbanknow.com",
  "토스뱅크": "tossbank.com",

  // 지방은행
  "부산은행": "busanbank.co.kr",
  "대구은행": "dgb.co.kr",
  "iM뱅크": "dgb.co.kr",
  "경남은행": "knbank.co.kr",
  "광주은행": "kjbank.com",
  "전북은행": "jbbank.co.kr",
  "제주은행": "e-jejubank.com",

  // 특수은행
  "산업은행": "kdb.co.kr",
  "수출입은행": "koreaexim.go.kr",
  "수협은행": "suhyup-bank.com",

  // 저축은행 일부
  "SBI저축은행": "sbisb.co.kr",
  "OK저축은행": "oksavingsbank.com",
  "웰컴저축은행": "welcomebank.co.kr",
};

// ── public helpers ──────────────────────────────────────────

/** 주식 ticker → 로고 URL. 매핑 없으면 null. */
function stockLogoUrl(ticker) {
  if (!ticker) return null;
  const domain = STOCK_DOMAIN_MAP[ticker];
  return domain ? `${CLEARBIT_BASE}/${domain}` : null;
}

/** 은행명 → 로고 URL. 매핑 없으면 null. */
function bankLogoUrl(korCoNm) {
  if (!korCoNm) return null;
  // FSS 응답이 가끔 공백/주식회사 접두사 붙는 케이스 정규화.
  const normalized = String(korCoNm)
    .replace(/^주식회사\s*/, "")
    .replace(/\s*\([^)]*\)/g, "")
    .trim();

  // 정확 매칭 우선.
  if (BANK_DOMAIN_MAP[normalized]) {
    return `${CLEARBIT_BASE}/${BANK_DOMAIN_MAP[normalized]}`;
  }
  // 부분 매칭 (예: "(주)국민은행", "주식회사 국민은행" 등).
  for (const [key, domain] of Object.entries(BANK_DOMAIN_MAP)) {
    if (normalized.includes(key)) {
      return `${CLEARBIT_BASE}/${domain}`;
    }
  }
  return null;
}

module.exports = {
  stockLogoUrl,
  bankLogoUrl,
  STOCK_DOMAIN_MAP,
  BANK_DOMAIN_MAP,
};
