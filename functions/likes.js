const { onRequest } = require("firebase-functions/https");
const logger = require("firebase-functions/logger");
const { supabase, setCorsHeaders } = require("./config");
const { createNotification } = require("./notifications");

// 토글 헬퍼 — table에 (target_col, user_id) 행이 있으면 삭제(unlike), 없으면 추가(like).
async function _toggle(table, targetCol, targetId, userId) {
  logger.info(`_toggle ENTER: table=${table}, ${targetCol}=${targetId}, user_id=${userId}`);

  // 기존 행 조회.
  const { data: existing, error: findError } = await supabase
    .from(table)
    .select("id")
    .eq(targetCol, targetId)
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (findError) {
    logger.error(`_toggle FIND failed (${table}):`, JSON.stringify(findError));
    throw findError;
  }

  if (existing) {
    // 좋아요 취소.
    const { error } = await supabase
      .from(table)
      .delete()
      .eq("id", existing.id);
    if (error) {
      logger.error(`_toggle DELETE failed (${table}):`, JSON.stringify(error));
      throw error;
    }
    return { liked: false };
  }

  // 좋아요 추가.
  const insertPayload = { [targetCol]: targetId, user_id: userId };
  const { error } = await supabase.from(table).insert(insertPayload);
  if (error) {
    logger.error(`_toggle INSERT failed (${table}) payload=${JSON.stringify(insertPayload)}:`, JSON.stringify(error));
    throw error;
  }
  return { liked: true };
}

async function _countAndStatus(table, targetCol, targetId, userId) {
  const { count } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(targetCol, targetId);
  let mine = false;
  if (userId) {
    const { data } = await supabase
      .from(table)
      .select("id")
      .eq(targetCol, targetId)
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    mine = !!data;
  }
  return { count: count || 0, mine };
}

// 게시글 좋아요 토글
// POST /togglePostLike
// body: { post_id, user_id }
exports.togglePostLike = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 허용" });
  try {
    const { post_id, user_id } = req.body;
    if (!post_id || !user_id) {
      return res.status(400).json({ error: "post_id, user_id 필수" });
    }

    const result = await _toggle("post_likes", "post_id", post_id, user_id);
    const status = await _countAndStatus("post_likes", "post_id", post_id, user_id);

    // 좋아요 추가일 때만 알림. 게시글 작성자에게.
    if (result.liked) {
      try {
        const { data: post } = await supabase
          .from("posts")
          .select("user_id, title")
          .eq("id", post_id)
          .single();
        if (post) {
          const preview = (post.title || "").slice(0, 30);
          await createNotification({
            userId: post.user_id,
            selfUserId: user_id,
            type: "post_like",
            title: "내 게시글에 좋아요가 달렸어요",
            body: preview,
            targetId: `post-${post_id}`,
          });
        }
      } catch (e) {
        logger.warn("post_like 알림 생성 실패:", e?.message || e);
      }
    }

    return res.status(200).json({
      liked: result.liked,
      like_count: status.count,
    });
  } catch (err) {
    logger.error("togglePostLike error:", err);
    return res.status(500).json({ error: "게시글 좋아요 실패", detail: err?.message });
  }
});

// 댓글 좋아요 토글 (댓글 작성자에게 알림 생성).
// POST /toggleCommentLike
// body: { comment_id, user_id }
exports.toggleCommentLike = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 허용" });
  try {
    const { comment_id, user_id } = req.body;
    if (!comment_id || !user_id) {
      return res.status(400).json({ error: "comment_id, user_id 필수" });
    }

    const result = await _toggle("comment_likes", "comment_id", comment_id, user_id);
    const status = await _countAndStatus("comment_likes", "comment_id", comment_id, user_id);

    // 좋아요 추가일 때만 알림. 댓글 작성자에게.
    if (result.liked) {
      try {
        const { data: comment } = await supabase
          .from("comments")
          .select("user_id, content, post_id")
          .eq("id", comment_id)
          .single();
        if (comment) {
          const preview = (comment.content || "").slice(0, 30);
          await createNotification({
            userId: comment.user_id,
            selfUserId: user_id,
            type: "comment_like",
            title: "내 댓글에 좋아요가 달렸어요",
            body: preview,
            targetId: comment.post_id ? `post-${comment.post_id}` : null,
          });
        }
      } catch (e) {
        logger.warn("comment_like 알림 생성 실패:", e?.message || e);
      }
    }

    return res.status(200).json({
      liked: result.liked,
      like_count: status.count,
    });
  } catch (err) {
    logger.error("toggleCommentLike error:", err);
    return res.status(500).json({ error: "댓글 좋아요 실패", detail: err?.message });
  }
});

// 북마크 토글.
// POST /togglePostBookmark
// body: { post_id, user_id }
exports.togglePostBookmark = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 허용" });
  try {
    const { post_id, user_id } = req.body;
    if (!post_id || !user_id) {
      return res.status(400).json({ error: "post_id, user_id 필수" });
    }
    const result = await _toggle("bookmarks", "post_id", post_id, user_id);
    return res.status(200).json({ bookmarked: result.liked });
  } catch (err) {
    logger.error("togglePostBookmark error:", err);
    return res.status(500).json({ error: "북마크 실패", detail: err?.message });
  }
});
