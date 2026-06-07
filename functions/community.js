const { onRequest } = require("firebase-functions/https");
const logger = require("firebase-functions/logger");
const { supabase, setCorsHeaders } = require("./config");
const { createNotification } = require("./notifications");

// 게시글 row 배열에 like_count, my_liked, bookmarked 추가.
async function attachLikeStatus(rows, currentUserId) {
  const ids = rows.map((r) => r.id).filter(Boolean);
  if (ids.length === 0) return rows;

  // 좋아요 카운트 (각 post_id별 그룹)
  const counts = {};
  const myLikes = new Set();
  const myBookmarks = new Set();

  try {
    const { data: likes } = await supabase
      .from("post_likes")
      .select("post_id, user_id")
      .in("post_id", ids);
    for (const l of likes || []) {
      counts[l.post_id] = (counts[l.post_id] || 0) + 1;
      if (currentUserId && l.user_id === currentUserId) myLikes.add(l.post_id);
    }
  } catch (e) {
    logger.warn("post_likes 조회 실패:", e?.message || e);
  }

  if (currentUserId) {
    try {
      const { data: bms } = await supabase
        .from("bookmarks")
        .select("post_id")
        .eq("user_id", currentUserId)
        .in("post_id", ids);
      for (const b of bms || []) myBookmarks.add(b.post_id);
    } catch (e) {
      logger.warn("bookmarks 조회 실패:", e?.message || e);
    }
  }

  return rows.map((r) => ({
    ...r,
    like_count: counts[r.id] || 0,
    liked_by_me: myLikes.has(r.id),
    bookmarked: myBookmarks.has(r.id),
  }));
}

// 댓글 row 배열에 like_count, liked_by_me 추가.
async function attachCommentLikeStatus(rows, currentUserId) {
  const ids = rows.map((r) => r.id).filter(Boolean);
  if (ids.length === 0) return rows;
  const counts = {};
  const myLikes = new Set();
  try {
    const { data: likes } = await supabase
      .from("comment_likes")
      .select("comment_id, user_id")
      .in("comment_id", ids);
    for (const l of likes || []) {
      counts[l.comment_id] = (counts[l.comment_id] || 0) + 1;
      if (currentUserId && l.user_id === currentUserId) {
        myLikes.add(l.comment_id);
      }
    }
  } catch (e) {
    logger.warn("comment_likes 조회 실패:", e?.message || e);
  }
  return rows.map((r) => ({
    ...r,
    like_count: counts[r.id] || 0,
    liked_by_me: myLikes.has(r.id),
  }));
}

// 작성자 정보 첨부 헬퍼 — FK 없이도 동작.
async function attachProfiles(rows) {
  const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
  if (userIds.length === 0) return rows.map((r) => ({ ...r, profiles: null }));

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, name, age")
    .in("id", userIds);

  if (error) {
    logger.warn("attachProfiles: 프로필 조회 실패", error.message);
    return rows.map((r) => ({ ...r, profiles: null }));
  }

  const map = {};
  for (const p of profiles || []) {
    map[p.id] = { name: p.name, age: p.age };
  }
  return rows.map((r) => ({ ...r, profiles: map[r.user_id] || null }));
}

// 각 게시글의 댓글 수 계산 (comments 테이블 count).
// 게시글 N개 × N쿼리 방지: post_id IN (...) 한 번에 가져와 카운트.
async function attachCommentCounts(rows) {
  const postIds = rows.map((r) => r.id).filter(Boolean);
  if (postIds.length === 0) {
    return rows.map((r) => ({ ...r, comment_count: 0 }));
  }
  const { data: comments, error } = await supabase
    .from("comments")
    .select("post_id")
    .in("post_id", postIds);

  if (error) {
    logger.warn("attachCommentCounts 실패:", error.message);
    return rows.map((r) => ({ ...r, comment_count: 0 }));
  }
  const counts = {};
  for (const c of comments || []) {
    counts[c.post_id] = (counts[c.post_id] || 0) + 1;
  }
  return rows.map((r) => ({ ...r, comment_count: counts[r.id] || 0 }));
}

// 게시글 목록 조회
// GET /getCommunityPosts?page=1&limit=20
exports.getCommunityPosts = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).send("");

  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const { data, error, count } = await supabase
      .from("posts")
      .select(
        "id, title, content, created_at, user_id, category, anonymous, view_count",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    const currentUserId = req.query.user_id || null;
    const withProfiles = await attachProfiles(data || []);
    const withCounts = await attachCommentCounts(withProfiles);
    const withLikes = await attachLikeStatus(withCounts, currentUserId);

    return res.status(200).json({
      posts: withLikes,
      total: count,
      page,
      totalPages: Math.ceil((count || 0) / limit),
    });
  } catch (err) {
    logger.error("getCommunityPosts error:", err);
    return res.status(500).json({ error: "게시글 목록 조회 실패", detail: err?.message });
  }
});

// 게시글 단건 조회
// GET /getPost?id=xxx
exports.getPost = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).send("");

  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "id 필수" });

    const { data, error } = await supabase
      .from("posts")
      .select(
        "id, title, content, created_at, user_id, category, anonymous, view_count",
      )
      .eq("id", id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: "게시글을 찾을 수 없습니다" });
    }

    // 조회수 +1 (best-effort, 실패해도 응답엔 영향 없음).
    const newViewCount = (data.view_count || 0) + 1;
    supabase
      .from("posts")
      .update({ view_count: newViewCount })
      .eq("id", id)
      .then(({ error: e }) => {
        if (e) logger.warn("view_count 증가 실패:", e.message);
      });
    data.view_count = newViewCount;

    const currentUserId = req.query.user_id || null;
    const [withProfile] = await attachProfiles([data]);
    const [withCount] = await attachCommentCounts([withProfile]);
    const [withLikes] = await attachLikeStatus([withCount], currentUserId);
    return res.status(200).json({ post: withLikes });
  } catch (err) {
    logger.error("getPost error:", err);
    return res.status(500).json({ error: "게시글 조회 실패", detail: err?.message });
  }
});

// 게시글 작성
// POST /createPost
// body: { user_id, title, content }
exports.createPost = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 허용" });

  try {
    const { user_id, title, content, category, anonymous } = req.body;
    if (!user_id || !title || !content) {
      return res.status(400).json({ error: "user_id, title, content 필수" });
    }

    const { data, error } = await supabase
      .from("posts")
      .insert({
        user_id,
        title,
        content,
        category: category || null,
        anonymous: anonymous === true,
      })
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json({ post: data });
  } catch (err) {
    logger.error("createPost error:", err);
    return res.status(500).json({ error: "게시글 작성 실패" });
  }
});

// 게시글 수정
// POST /updatePost
// body: { id, user_id, title, content }
exports.updatePost = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 허용" });

  try {
    const { id, user_id, title, content, category, anonymous } = req.body;
    if (!id || !user_id || !title || !content) {
      return res.status(400).json({ error: "id, user_id, title, content 필수" });
    }

    // 소유권 확인
    const { data: existing, error: findError } = await supabase
      .from("posts")
      .select("user_id")
      .eq("id", id)
      .single();

    if (findError || !existing) {
      return res.status(404).json({ error: "게시글을 찾을 수 없습니다" });
    }
    if (existing.user_id !== user_id) {
      return res.status(403).json({ error: "수정 권한이 없습니다" });
    }

    const updates = { title, content };
    if (category !== undefined) updates.category = category || null;
    if (anonymous !== undefined) updates.anonymous = anonymous === true;

    const { data, error } = await supabase
      .from("posts")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json({ post: data });
  } catch (err) {
    logger.error("updatePost error:", err);
    return res.status(500).json({ error: "게시글 수정 실패" });
  }
});

// 게시글 삭제
// POST /deletePost
// body: { id, user_id }
exports.deletePost = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 허용" });

  try {
    const { id, user_id } = req.body;
    if (!id || !user_id) {
      return res.status(400).json({ error: "id, user_id 필수" });
    }

    // 소유권 확인
    const { data: existing, error: findError } = await supabase
      .from("posts")
      .select("user_id")
      .eq("id", id)
      .single();

    if (findError || !existing) {
      return res.status(404).json({ error: "게시글을 찾을 수 없습니다" });
    }
    if (existing.user_id !== user_id) {
      return res.status(403).json({ error: "삭제 권한이 없습니다" });
    }

    // 댓글 먼저 삭제 (FK 제약 회피)
    await supabase.from("comments").delete().eq("post_id", id);

    const { error } = await supabase.from("posts").delete().eq("id", id);
    if (error) throw error;

    return res.status(200).json({ success: true });
  } catch (err) {
    logger.error("deletePost error:", err);
    return res.status(500).json({ error: "게시글 삭제 실패" });
  }
});

// 댓글 목록 조회
// GET /getComments?post_id=xxx
exports.getComments = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).send("");

  try {
    const { post_id } = req.query;
    if (!post_id) return res.status(400).json({ error: "post_id 필수" });

    const currentUserId = req.query.user_id || null;
    const { data, error } = await supabase
      .from("comments")
      .select("id, content, created_at, user_id")
      .eq("post_id", post_id)
      .order("created_at", { ascending: true });

    if (error) throw error;

    const withProfiles = await attachProfiles(data || []);
    const withLikes = await attachCommentLikeStatus(withProfiles, currentUserId);
    return res.status(200).json({ comments: withLikes });
  } catch (err) {
    logger.error("getComments error:", err);
    return res.status(500).json({ error: "댓글 조회 실패", detail: err?.message });
  }
});

// 댓글 작성
// POST /createComment
// body: { post_id, user_id, content }
exports.createComment = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 허용" });

  try {
    const { post_id, user_id, content } = req.body;
    if (!post_id || !user_id || !content) {
      return res.status(400).json({ error: "post_id, user_id, content 필수" });
    }

    const { data, error } = await supabase
      .from("comments")
      .insert({ post_id, user_id, content })
      .select()
      .single();

    if (error) throw error;

    // 게시글 작성자에게 알림 생성 (자기 글에 자기가 댓글이면 skip).
    try {
      const { data: post } = await supabase
        .from("posts")
        .select("user_id, title")
        .eq("id", post_id)
        .single();
      if (post) {
        const preview = (content || "").slice(0, 30);
        await createNotification({
          userId: post.user_id,
          selfUserId: user_id,
          type: "comment",
          title: "내 게시글에 댓글이 달렸어요",
          body: preview,
          targetId: `post-${post_id}`,
        });
      }
    } catch (e) {
      logger.warn("comment 알림 생성 실패:", e?.message || e);
    }

    return res.status(201).json({ comment: data });
  } catch (err) {
    logger.error("createComment error:", err);
    return res.status(500).json({ error: "댓글 작성 실패" });
  }
});

// 댓글 수정
// POST /updateComment
// body: { id, user_id, content }
exports.updateComment = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 허용" });

  try {
    const { id, user_id, content } = req.body;
    if (!id || !user_id || !content) {
      return res.status(400).json({ error: "id, user_id, content 필수" });
    }

    const { data: existing, error: findError } = await supabase
      .from("comments")
      .select("user_id")
      .eq("id", id)
      .single();

    if (findError || !existing) {
      return res.status(404).json({ error: "댓글을 찾을 수 없습니다" });
    }
    if (existing.user_id !== user_id) {
      return res.status(403).json({ error: "수정 권한이 없습니다" });
    }

    const { data, error } = await supabase
      .from("comments")
      .update({ content })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json({ comment: data });
  } catch (err) {
    logger.error("updateComment error:", err);
    return res.status(500).json({ error: "댓글 수정 실패" });
  }
});

// 댓글 삭제
// POST /deleteComment
// body: { id, user_id }
exports.deleteComment = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 허용" });

  try {
    const { id, user_id } = req.body;
    if (!id || !user_id) {
      return res.status(400).json({ error: "id, user_id 필수" });
    }

    const { data: existing, error: findError } = await supabase
      .from("comments")
      .select("user_id")
      .eq("id", id)
      .single();

    if (findError || !existing) {
      return res.status(404).json({ error: "댓글을 찾을 수 없습니다" });
    }
    if (existing.user_id !== user_id) {
      return res.status(403).json({ error: "삭제 권한이 없습니다" });
    }

    const { error } = await supabase.from("comments").delete().eq("id", id);
    if (error) throw error;

    return res.status(200).json({ success: true });
  } catch (err) {
    logger.error("deleteComment error:", err);
    return res.status(500).json({ error: "댓글 삭제 실패" });
  }
});
