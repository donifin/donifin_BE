const { onRequest } = require("firebase-functions/https");
const logger = require("firebase-functions/logger");
const { supabase, setCorsHeaders } = require("./config");

/**
 * 알림 1건 생성 (다른 endpoint에서 호출하는 헬퍼).
 * - 자기 자신에겐 알림 보내지 않음 (예: 자기 글에 자기가 댓글).
 * - 실패해도 throw 안 함 (호출자 흐름 안 끊김).
 */
async function createNotification({ userId, type, title, body, targetId, selfUserId }) {
  if (!userId) return;
  if (selfUserId && selfUserId === userId) return; // 자기 자신 패스
  try {
    const { error } = await supabase.from("notifications").insert({
      user_id: userId,
      type,
      title,
      body: body || null,
      target_id: targetId || null,
    });
    if (error) logger.warn("createNotification 실패:", error.message);
  } catch (e) {
    logger.warn("createNotification 예외:", e?.message || e);
  }
}

/**
 * 오늘의 퀴즈 알림을 lazy 생성.
 * getNotifications 호출 시 1일 1회 자동으로 등록.
 */
async function ensureTodayQuizNotification(userId) {
  if (!userId) return;
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const targetId = `quiz-${today}`;
  try {
    const { data: existing } = await supabase
      .from("notifications")
      .select("id")
      .eq("user_id", userId)
      .eq("type", "quiz")
      .eq("target_id", targetId)
      .limit(1);
    if (existing && existing.length > 0) return;
    await supabase.from("notifications").insert({
      user_id: userId,
      type: "quiz",
      title: "오늘의 금융 퀴즈가 등록됐어요!",
      body: "데일리 OX 퀴즈로 금융 상식을 늘려보세요.",
      target_id: targetId,
    });
  } catch (e) {
    logger.warn("ensureTodayQuizNotification 실패:", e?.message || e);
  }
}

// 알림 목록 조회 (오늘 퀴즈 알림 lazy 생성 포함).
// GET /getNotifications?user_id=xxx
exports.getNotifications = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  try {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: "user_id 필수" });

    await ensureTodayQuizNotification(user_id);

    const { data, error } = await supabase
      .from("notifications")
      .select("id, type, title, body, target_id, read, created_at")
      .eq("user_id", user_id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;
    const unreadCount = (data || []).filter((n) => !n.read).length;
    return res.status(200).json({ notifications: data || [], unread_count: unreadCount });
  } catch (err) {
    logger.error("getNotifications error:", err);
    return res.status(500).json({ error: "알림 조회 실패", detail: err?.message });
  }
});

// 알림 모두 읽음 처리.
// POST /markAllNotificationsRead
// body: { user_id }
exports.markAllNotificationsRead = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 허용" });
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: "user_id 필수" });

    const { error } = await supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", user_id)
      .eq("read", false);

    if (error) throw error;
    return res.status(200).json({ success: true });
  } catch (err) {
    logger.error("markAllNotificationsRead error:", err);
    return res.status(500).json({ error: "알림 읽음 처리 실패", detail: err?.message });
  }
});

module.exports.createNotification = createNotification;
