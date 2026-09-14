/**
 * AI inference client for the Health & Air Quality Assistant.
 *
 * Architecture (one path, one fallback):
 * 1. BACKEND PROXY — POST /api/v1/health/chat. The server injects its own
 *    GROQ_API_KEY (from .env); the browser never sees or holds any key.
 * 2. ON-DEVICE CLINICAL BRAIN — generateClinicalResponse(). Works fully
 *    offline whenever the proxy is unreachable.
 *
 * The optional per-user key (localStorage) exists only for power users who
 * want their own Gemini/Groq quota; when present it is forwarded to the
 * backend proxy, which uses it instead of the server key. It is never sent
 * to third parties from the browser and never embedded in the bundle.
 */

import { generateClinicalResponse } from "./clinicalEngine";

export interface GroqModelConfig {
  id: string;
  name: string;
  contextWindow: number;
}

/** Display names only — model selection happens server-side. */
export const GROQ_MODELS: GroqModelConfig[] = [
  { id: "qwen/qwen3.8-27b", name: "Qwen 3.8 27B", contextWindow: 131072 },
  { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B", contextWindow: 131072 },
  { id: "qwen/qwen3.6-27b", name: "Qwen 3.6 27B", contextWindow: 131072 },
  { id: "openai/gpt-oss-20b", name: "GPT-OSS 20B", contextWindow: 131072 },
  { id: "groq/compound-mini", name: "Groq Compound Mini", contextWindow: 131072 },
  { id: "allam-2-7b", name: "ALLaM 2 7B", contextWindow: 4096 },
];

export interface ChatMessage {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  modelUsed?: string;
  latencyMs?: number;
  fallbackNotes?: string | string[];
  timestamp?: string;
  status?: "streaming" | "done" | "error";
  attempts?: Array<{ model: string; success: boolean; error?: string }>;
}

export interface LiveAirQualityContext {
  aqi?: number;
  category?: string;
  pm25?: number;
  pm10?: number;
  no2?: number;
  pblHeightM?: number;
  inversionPresent?: boolean;
  inversionDeltaT?: number;
  plumeContribution?: number;
  plumeFraction?: number;
  generatedAt?: string;
  dominantPollutant?: string;
}

export function buildHealthSystemPrompt(ctx?: LiveAirQualityContext, language?: string): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-IN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeStr = now.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  const aqi = ctx?.aqi ?? 342;
  const category = ctx?.category ?? "Very Poor";
  const pm25 = ctx?.pm25 ? Math.round(ctx.pm25) : 180;
  const pm10 = ctx?.pm10 ? Math.round(ctx.pm10) : 305;
  const no2 = ctx?.no2 ? Math.round(ctx.no2) : 48;
  const pbl = ctx?.pblHeightM ? Math.round(ctx.pblHeightM) : 320;
  const invDt = ctx?.inversionDeltaT ? ctx.inversionDeltaT.toFixed(1) : "2.1";

  const langDirective = language === "hi"
    ? "Respond fluently in natural Devanagari Hindi (हिन्दी)."
    : language === "ta"
    ? "Respond fluently in natural Tamil (தமிழ்)."
    : "Respond in clear English.";

  return `You are the Delhi NCR Health Care Assistant & Clinical Air Specialist embedded in the NCR·72 coupled AQI forecast console.

Today: ${dateStr}, ${timeStr} (IST).

=== LIVE ATMOSPHERIC CONTEXT (update each turn) ===
- Regional AQI: ${aqi} (${category})
- PM2.5: ${pm25} µg/m³ | PM10: ${pm10} µg/m³ | NO₂: ${no2} ppb
- Planetary Boundary Layer: ~${pbl} m ${ctx?.inversionPresent ? `(thermal inversion active, ΔT ≈ ${invDt}°C — pollutants trapped)` : "(well-mixed)"}
- Dominant pollutant: ${ctx?.dominantPollutant ?? "PM2.5"}

=== DELHI NCR domain knowledge ===
- Highest AQI in Delhi History: In early November 2019 and November 2023/2024, Delhi experienced catastrophic air quality episodes where the official 24-hour average AQI maxed out the official scale at 494–500 (Severe+ / Hazardous). In individual sub-stations (such as Anand Vihar, Bawana, and Jahangirpuri) and local sensors in November 2024, hourly PM2.5 readings spiked past 1,000–1,500 µg/m³ with AQI equivalent calculations crossing 1,000+.
- Seasonality: Winter spikes (October–January) are caused by post-monsoon crop residue burning in Punjab/Haryana, calm surface winds (<2 km/h), shallow planetary boundary layer (<150–300m), and severe radiative thermal inversion trapping vehicle and industrial emissions.

=== CORE INSTRUCTIONS ===
1. **General & Broad Inquiries:** You are a fully capable general AI assistant. You can answer ANY question (world history, science, coding, math, general advice, geography, culture, language translation, creative writing, or friendly conversation) accurately, thoroughly, and helpfully.
2. **Delhi NCR Air & Health:** Provide grounded, evidence-based pulmonary medical advice (asthma inhalers, budesonide, salbutamol, N95/FFP2 fit physics, True HEPA CADR air purifier sizing, safe exercise windows 1:30 PM - 4:00 PM).
3. **Tone:** Friendly, direct, professional, clear, and well-structured with markdown headings and bullet points where helpful. Never output robotic repetitive disclaimers.
${langDirective}`;
}

export interface GroqExecutionResult {
  content: string;
  modelUsed: string;
  latencyMs: number;
  attempts: Array<{
    model: string;
    success: boolean;
    error?: string;
    durationMs: number;
  }>;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms)
    ),
  ]);
}

export async function executeGroqChat(
  userKey: string,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  onStatusUpdate?: (status: string) => void,
  airContext?: LiveAirQualityContext,
  language: string = "en",
): Promise<GroqExecutionResult> {
  const lastUserMsg = messages.filter((m) => m.role === "user").pop()?.content || "";
  const startTime = performance.now();
  const attempts: GroqExecutionResult["attempts"] = [];

  // Prepare standard system prompt if not present
  const systemPrompt = buildHealthSystemPrompt(airContext, language);
  const formattedMessages = [
    { role: "system", content: systemPrompt },
    ...messages.filter((m) => m.role !== "system"),
  ];

  // ──────────────────────────────────────────────────────────────────────────
  // 1. BACKEND PROXY (server holds the GROQ_API_KEY from .env; the optional
  //    user key is forwarded so power users can spend their own quota).
  // ──────────────────────────────────────────────────────────────────────────
  const key = userKey.trim();
  try {
    if (onStatusUpdate) {
      onStatusUpdate(key ? "Consulting cloud AI (your key)..." : "Consulting Delhi Air AI Brain (cloud)...");
    }

    const proxyFetch = fetch("/api/v1/health/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: formattedMessages,
        api_key: key || undefined,
        temperature: 0.7,
        max_tokens: 2048,
      }),
    });

    const proxyResp = await withTimeout(proxyFetch, 20000);
    if (proxyResp.ok) {
      const result: GroqExecutionResult = await proxyResp.json();
      if (result.content && result.content.trim()) {
        return result;
      }
      attempts.push({ model: result.modelUsed || "proxy", success: false, error: "Empty response", durationMs: 0 });
    } else {
      const errBody = await proxyResp.json().catch(() => null);
      const detail =
        errBody && typeof errBody.detail === "string" ? errBody.detail : `HTTP ${proxyResp.status}`;
      attempts.push({ model: "Backend AI Gateway", success: false, error: detail, durationMs: 0 });
    }
  } catch (proxyErr) {
    attempts.push({
      model: "Backend AI Gateway",
      success: false,
      error: proxyErr instanceof Error ? proxyErr.message : "Unreachable",
      durationMs: 0,
    });
    console.warn("[HealthChat Proxy] Failed:", proxyErr);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 2. ON-DEVICE CLINICAL BRAIN (offline fallback)
  // ──────────────────────────────────────────────────────────────────────────
  if (onStatusUpdate) {
    onStatusUpdate("Consulting Clinical Intelligence Specialist...");
  }

  const clinicalRes = generateClinicalResponse(lastUserMsg, airContext, language);
  const elapsed = Math.round(performance.now() - startTime);

  attempts.push({
    model: clinicalRes.modelUsed,
    success: true,
    durationMs: Math.max(100, elapsed),
  });

  return {
    content: clinicalRes.content,
    modelUsed: clinicalRes.modelUsed,
    latencyMs: Math.max(100, elapsed),
    attempts,
  };
}
