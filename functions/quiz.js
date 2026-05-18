const { onRequest } = require("firebase-functions/https");
const logger = require("firebase-functions/logger");
const { openai, setCorsHeaders } = require("./config");

// 일일 OX 퀴즈 캐시 — 같은 날짜에는 재생성 없이 같은 문제 반환.
// 메모리 캐시 (emulator 재시작 시 초기화). 운영에선 Firestore 등으로 옮기는 게 안전.
const dailyCache = new Map(); // "YYYY-MM-DD" → { questions: [...] }

function todayKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// AI 응답 파싱 실패 시 사용할 폴백 문제. 진짜 의도된 흐름은 GPT 생성.
const FALLBACK_QUIZZES = [
  {
    question: "예금자 보호법은 1인당 1금융기관 최대 5천만원까지 보호한다.",
    answer: true,
    explanation:
      "맞아요. 예금보험공사가 원금과 이자를 합쳐 1금융기관당 5천만원까지 보호해줍니다.",
  },
  {
    question: "신용카드 리볼빙은 금리가 일반 카드 결제보다 낮은 편이다.",
    answer: false,
    explanation:
      "아니요. 리볼빙 수수료는 연 15~20%대로 일반 카드 할부보다 훨씬 높습니다.",
  },
  {
    question: "주식의 배당락일에 매수하면 그 분기 배당을 받을 수 있다.",
    answer: false,
    explanation:
      "아닙니다. 배당 받으려면 배당기준일(배당락일 전일)까지 매수해서 보유해야 합니다.",
  },
];

async function generateQuizWithAI() {
  const prompt = `너는 한국 금융 교육 콘텐츠 작가야.
일반인이 알아두면 좋은 금융 상식을 OX 형태로 만들어줘.

규칙:
- 3개의 문제 생성
- 한국 사정에 맞는 실용적 주제 (예금자 보호, 카드, 대출, 세금, 투자, 보험 등)
- 너무 쉽거나 모호하지 않게
- 설명은 친근한 말투로 2~3문장

반드시 아래 JSON 배열 형식으로만 답해. 다른 텍스트 절대 포함하지 마.
[
  { "question": "문제 본문", "answer": true, "explanation": "정답 설명" },
  { "question": "...", "answer": false, "explanation": "..." },
  { "question": "...", "answer": true, "explanation": "..." }
]`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 800,
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0].message.content;
  // JSON 객체로 받았을 수도 있어 둘 다 처리.
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  // 응답이 { quizzes: [...] } 또는 [...] 둘 다 처리.
  const arr = Array.isArray(parsed)
    ? parsed
    : (parsed.quizzes || parsed.questions || parsed.items || parsed.data);
  if (!Array.isArray(arr) || arr.length < 3) return null;
  return arr.slice(0, 3).map((q, i) => ({
    id: i + 1,
    question: String(q.question || "").trim(),
    answer: q.answer === true || q.answer === "true" || q.answer === "O",
    explanation: String(q.explanation || "").trim(),
  }));
}

// GET /getQuiz
// 응답: { date: "YYYY-MM-DD", questions: [{ id, question, answer, explanation }, ...] }
exports.getQuiz = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).send("");

  const date = todayKey();
  try {
    if (dailyCache.has(date)) {
      return res.status(200).json({ date, ...dailyCache.get(date) });
    }

    let questions = null;
    try {
      questions = await generateQuizWithAI();
    } catch (e) {
      logger.warn("AI 퀴즈 생성 실패, 폴백 사용:", e?.message || e);
    }
    if (!questions || questions.length < 3) {
      questions = FALLBACK_QUIZZES.map((q, i) => ({ id: i + 1, ...q }));
    }
    const payload = { questions };
    dailyCache.set(date, payload);
    return res.status(200).json({ date, ...payload });
  } catch (err) {
    logger.error("getQuiz error:", err);
    return res.status(500).json({ error: "퀴즈 조회 실패" });
  }
});
