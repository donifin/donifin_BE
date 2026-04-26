require("dotenv").config();

const { setGlobalOptions } = require("firebase-functions");
setGlobalOptions({ maxInstances: 10 });

// ── 클라우드 함수 등록 ────────────────────────────────────────
const { getProducts }             = require("./products");
const { chatBot }                 = require("./chatbot");
const { getPersonalityQuestions,
        personalityTest }         = require("./personality");
const { getNews }                 = require("./news");
const { getCommunityPosts,
        createPost,
        getComments,
        createComment }           = require("./community");
const { recordProductView,
        getPopularProducts }      = require("./popular");
const { saveProfile }             = require("./profile");

// ── 내보내기 ─────────────────────────────────────────────────
module.exports = {
  getProducts,
  chatBot,
  getPersonalityQuestions,
  personalityTest,
  getNews,
  getCommunityPosts,
  createPost,
  getComments,
  createComment,
  recordProductView,
  getPopularProducts,
  saveProfile,
};
