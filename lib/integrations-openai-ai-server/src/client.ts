import OpenAI from "openai";

export const aiConfigured = Boolean(process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY);
export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY || "not-configured",
  baseURL: process.env.OPENAI_BASE_URL || process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || "https://api.openai.com/v1",
  fetch: (input, init) => {
    if (!aiConfigured) throw new Error("AI is not configured. Set OPENAI_API_KEY on the server; notes and recordings remain available.");
    return globalThis.fetch(input, init);
  },
});
