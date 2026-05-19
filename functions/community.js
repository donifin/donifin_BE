const { onRequest } = require("firebase-functions/https");
const logger = require("firebase-functions/logger");
const { supabase, setCorsHeaders } = require("./config");

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
      .select("id, title, content, created_at, user_id", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    const withProfiles = await attachProfiles(data || []);

    return res.status(200).json({
      posts: withProfiles,
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
      .select("id, title, content, created_at, user_id")
      .eq("id", id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: "게시글을 찾을 수 없습니다" });
    }

    const [withProfile] = await attachProfiles([data]);
    return res.status(200).json({ post: withProfile });
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
    const { user_id, title, content } = req.body;
    if (!user_id || !title || !content) {
      return res.status(400).json({ error: "user_id, title, content 필수" });
    }

    const { data, error } = await supabase
      .from("posts")
      .insert({ user_id, title, content })
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
    const { id, user_id, title, content } = req.body;
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

    const { data, error } = await supabase
      .from("posts")
      .update({ title, content })
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

    const { data, error } = await supabase
      .from("comments")
      .select("id, content, created_at, user_id")
      .eq("post_id", post_id)
      .order("created_at", { ascending: true });

    if (error) throw error;

    const withProfiles = await attachProfiles(data || []);
    return res.status(200).json({ comments: withProfiles });
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
