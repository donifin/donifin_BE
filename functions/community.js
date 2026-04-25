const { onRequest } = require("firebase-functions/https");
const logger = require("firebase-functions/logger");
const { supabase, setCorsHeaders } = require("./config");

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
      .select("id, title, content, created_at, user_id, profiles(age_group)", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    return res.status(200).json({
      posts: data,
      total: count,
      page,
      totalPages: Math.ceil(count / limit),
    });
  } catch (err) {
    logger.error("getCommunityPosts error:", err);
    return res.status(500).json({ error: "게시글 목록 조회 실패" });
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
      .select("id, content, created_at, user_id, profiles(age_group)")
      .eq("post_id", post_id)
      .order("created_at", { ascending: true });

    if (error) throw error;

    return res.status(200).json({ comments: data });
  } catch (err) {
    logger.error("getComments error:", err);
    return res.status(500).json({ error: "댓글 조회 실패" });
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
