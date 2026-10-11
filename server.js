import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(helmet({
  // This prototype displays generated video through a data: URL in the page.
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      mediaSrc: ["'self'", "data: blob:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: null
    }
  }
}));
app.use(express.json({ limit: "2mb" }));
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, apiKeyConfigured: Boolean(process.env.GEMINI_API_KEY) });
});
app.use("/api/", rateLimit({ windowMs: 60_000, limit: 4, standardHeaders: "draft-7", legacyHeaders: false }));
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/generate", async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        error: "На сервере не настроен GEMINI_API_KEY. Скопируй .env.example в .env и добавь свой ключ."
      });
    }

    const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
    const aspectRatio = req.body?.aspectRatio === "9:16" ? "9:16" : "16:9";

    if (!prompt) return res.status(400).json({ error: "Напиши описание видео." });
    if (prompt.length > 1200) return res.status(400).json({ error: "Описание слишком длинное (максимум 1200 символов)." });

    const ai = new GoogleGenAI({ apiKey });
    const interaction = await ai.interactions.create({
      model: "gemini-omni-1.1-flash",
      input: prompt,
      response_format: {
        type: "video",
        aspect_ratio: aspectRatio
      }
    });

    const video = interaction?.output_video?.data;
    if (!video) {
      console.error("Gemini response had no output_video data. Status:", interaction?.status);
      return res.status(502).json({ error: "Модель не вернула видео. Проверь доступ к модели и попробуй ещё раз." });
    }

    res.json({ video, model: "gemini-omni-1.1-flash" });
  } catch (error) {
    console.error("Video generation failed:", error?.message || error);
    const status = Number(error?.status || error?.statusCode);
    if (status === 401 || status === 403) {
      return res.status(502).json({ error: "Google отклонил запрос. Проверь ключ API, проект и доступ к модели." });
    }
    if (status === 429) {
      return res.status(429).json({ error: "Превышен лимит запросов или квота API. Попробуй позже." });
    }
    res.status(500).json({ error: "Не удалось сгенерировать видео. Проверь серверный журнал и настройки Google API." });
  }
});

app.use("/api", (_req, res) => res.status(404).json({ error: "API endpoint не найден. Открой сайт через сервер ponka.ai на localhost:3000, а не как статический HTML-файл." }));
app.get("/{*splat}", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => {
  console.log(`ponka.ai is running at http://localhost:${PORT}`);
  if (!process.env.GEMINI_API_KEY) console.warn("GEMINI_API_KEY is missing. Add it to .env before generating videos.");
});
