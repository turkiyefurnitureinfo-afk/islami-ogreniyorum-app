require("dotenv").config();
const { getAIAnswer } = require("./ai-answer");

async function test() {
  console.log("Testing local AI answer with parallel fallback...");
  const start = Date.now();
  try {
    const result = await getAIAnswer("abdest nasil alinir", "tr");
    const elapsed = Date.now() - start;
    console.log("Elapsed:", elapsed, "ms");
    if (result) {
      console.log("Provider:", result.provider);
      console.log("Model:", result.model || "N/A");
      console.log("Sources:", result.sources ? result.sources.length : 0);
      console.log("Answer:", result.answer.slice(0, 200) + (result.answer.length > 200 ? "..." : ""));
    } else {
      console.log("Result: null (no answer available)");
    }
  } catch (error) {
    console.error("Error:", error.message);
    if (error.stack) {
      console.error("Stack:", error.stack);
    }
  }
}
test().catch(e => console.error("Fatal error:", e.message));