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
    hint: "은행이 망해도 정부가 보호해주는 제도가 있죠. 한도 금액이 핵심입니다.",
    hint2: "원금과 이자를 합쳐 계산하며, 한도는 천만 단위입니다. 5와 가까운 숫자를 떠올려보세요.",
  },
  {
    question: "신용카드 리볼빙은 금리가 일반 카드 결제보다 낮은 편이다.",
    answer: false,
    explanation:
      "아니요. 리볼빙 수수료는 연 15~20%대로 일반 카드 할부보다 훨씬 높습니다.",
    hint: "결제를 미뤄주는 서비스는 보통 그만큼 대가가 따릅니다. 카드사 입장에서 생각해보세요.",
    hint2: "리볼빙 수수료는 연 15~20%로 일반 대출 금리보다도 높은 편입니다.",
  },
  {
    question: "주식의 배당락일에 매수하면 그 분기 배당을 받을 수 있다.",
    answer: false,
    explanation:
      "아닙니다. 배당 받으려면 배당기준일(배당락일 전일)까지 매수해서 보유해야 합니다.",
    hint: "'배당락'의 '락(落)'은 떨어진다는 뜻입니다. 무엇이 떨어지는 시점일까요?",
    hint2: "배당락일은 배당 권리가 사라지는 첫날입니다. 그 전날까지 보유해야 받을 수 있어요.",
  },
];

async function generateQuizWithAI() {
  const prompt = `너는 한국 금융 교육 콘텐츠 작가야.
일반인이 알아두면 좋은 금융 상식을 OX 형태로 만들어줘.

규칙:
- 3개의 문제 생성
- 한국 사정에 맞는 실용적 주제 (예금자 보호, 카드, 대출, 세금, 투자, 보험, 신용, 환율 등)
- 너무 쉽거나 모호하지 않게 — 50%의 사람이 헷갈릴 만한 수준
- 설명은 친근한 말투로 2~3문장, 정확한 수치/근거 포함

**힌트는 2단계로** 만들어:
- hint (1차 힌트): 핵심 개념·키워드만 던지는 한 문장. 단정형 표현(맞아요/아니요/X입니다) 금지. 단어의 어원이나 관련 제도를 떠올리게 하는 방향.
- hint2 (2차 힌트, 더보기용): 1차보다 한 단계 구체적. 범위를 좁혀주거나 수치 단위/방향성을 알려줌. 하지만 여전히 정답(O/X)을 직접 말하면 안 됨.

좋은 힌트 예시:
  Q: "예금자 보호는 5천만원까지 보장한다"
  hint: "정부가 보호해주는 한도가 있죠. 천만 단위로 떠올려보세요."
  hint2: "한도는 원금과 이자를 합쳐 5와 가까운 숫자입니다."

나쁜 힌트 예시 (절대 X):
  - "정답은 O입니다" (정답 노출)
  - "잘 생각해보세요" (도움 안 됨)
  - "맞습니다. 5천만원이에요." (정답+근거 다 노출)

반드시 아래 JSON 배열 형식으로만 답해. 다른 텍스트 절대 포함하지 마.
[
  { "question": "문제 본문", "answer": true, "explanation": "정답 설명", "hint": "1차 힌트", "hint2": "2차 힌트 (더 구체적)" },
  { "question": "...", "answer": false, "explanation": "...", "hint": "...", "hint2": "..." },
  { "question": "...", "answer": true, "explanation": "...", "hint": "...", "hint2": "..." }
]`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 1000,
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
    hint: String(q.hint || "").trim(),
    hint2: String(q.hint2 || "").trim(),
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
