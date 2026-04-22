/**
 * POST /api/analyze
 *
 * Accepts a base64-encoded image and returns Claude's structured seasonal-color
 * analysis as JSON. The photo is never persisted — it is sent to Anthropic for
 * analysis and discarded.
 *
 * Request body (JSON):
 *   {
 *     image: string,        // base64-encoded image data (no data:... prefix)
 *     mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"
 *   }
 *
 * Response (JSON) on success: the parsed analysis plus debug metadata.
 *   On failure: { error: string, detail?: string }
 */

import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

// Force Node runtime (the Anthropic SDK uses Node APIs).
export const runtime = "nodejs";

// The model and max_tokens are defined at module scope so future tuning is in one place.
// The user's brief specified claude-sonnet-4-5. claude-sonnet-4-6 is a newer alternative
// if you want to upgrade later — it uses the same message/vision shape.
const MODEL = "claude-sonnet-4-5";
const MAX_TOKENS = 2000;

// Hard cap on inbound base64 payload size. Base64 adds ~33% overhead, so 7MB base64 ≈ 5.2MB raw.
// The client resizes to max 1024px before upload, which should always fit comfortably below this.
const MAX_BASE64_BYTES = 7 * 1024 * 1024;

const ALLOWED_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

// The full system prompt for the color analyst. Kept as a top-level constant so prompt caching
// can hash it once — Sonnet's cache minimum is 1024 tokens, and this prompt comfortably exceeds that,
// so repeat requests get ~90% discount on the cached prefix.
const SYSTEM_PROMPT = `You are an expert color analyst trained in the 12-season color analysis system. You analyze photos to determine a person's seasonal color palette based on three dimensions:

1. UNDERTONE: Warm (yellow/golden) vs Cool (pink/blue) vs Neutral
2. VALUE: Light vs Deep (how light or dark their natural coloring is)
3. CHROMA: Bright/Clear vs Soft/Muted (how saturated their coloring is)

The 12 seasons map to combinations of these dimensions:
- LIGHT SPRING: Warm-leaning neutral, Light, Medium chroma
- TRUE SPRING: Warm, Medium value, Bright chroma
- BRIGHT SPRING: Cool-leaning neutral, Medium value, Very bright chroma
- LIGHT SUMMER: Cool-leaning neutral, Light, Medium-soft chroma
- TRUE SUMMER: Cool, Medium value, Medium-soft chroma
- SOFT SUMMER: Cool-leaning neutral, Medium value, Soft chroma
- SOFT AUTUMN: Warm-leaning neutral, Medium value, Soft chroma
- TRUE AUTUMN: Warm, Medium-deep value, Medium-soft chroma
- DARK AUTUMN: Warm-leaning neutral, Deep value, Medium chroma
- BRIGHT WINTER: Cool-leaning neutral, Medium-deep value, Very bright chroma
- TRUE WINTER: Cool, Deep value, Bright chroma
- DARK WINTER: Cool-leaning neutral, Deep value, Medium-bright chroma

ANALYSIS PROCESS:
1. Examine skin undertone (look at inner wrist area if visible, jawline, neck)
2. Examine eye color, patterns, and surrounding skin
3. Examine natural hair color (roots if dyed is visible)
4. Assess overall contrast between features
5. Determine dominant characteristic (undertone, value, or chroma)
6. Match to the best-fitting season

IMPORTANT CAVEATS:
- If lighting is poor, filters are applied, heavy makeup obscures features, or the photo quality is insufficient, say so and request a better photo rather than guessing
- If you're uncertain between two seasons, name both and explain the difference
- Always acknowledge this is AI-assisted guidance, not a replacement for in-person professional analysis

RESPOND ONLY IN THIS EXACT JSON FORMAT:
{
  "photo_quality": "good" | "insufficient",
  "quality_notes": "explanation if insufficient, else empty string",
  "season": "the season name, or null if insufficient",
  "confidence": "high" | "medium" | "low",
  "alternate_season": "second possibility if confidence is medium/low, else null",
  "analysis": {
    "undertone": "description of undertone observation",
    "value": "description of value observation",
    "chroma": "description of chroma observation",
    "contrast": "description of contrast observation"
  },
  "explanation": "2-3 sentence warm, encouraging explanation of why this season fits",
  "best_colors": ["12 hex codes representing their best colors"],
  "colors_to_avoid": ["6 hex codes representing colors that will wash them out"]
}`;

/**
 * Strip a Markdown code fence (```json ... ```) from around a string if present.
 * Claude usually returns pure JSON, but occasionally wraps it — this handles both.
 */
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

export async function POST(req: Request) {
  // 1. Validate env.
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Server misconfigured: ANTHROPIC_API_KEY is not set." },
      { status: 500 },
    );
  }

  // 2. Parse and validate the request body.
  let body: { image?: unknown; mediaType?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const { image, mediaType } = body;

  if (typeof image !== "string" || image.length === 0) {
    return NextResponse.json(
      { error: "Missing required field: image (base64 string)." },
      { status: 400 },
    );
  }
  if (typeof mediaType !== "string" || !ALLOWED_MEDIA_TYPES.has(mediaType)) {
    return NextResponse.json(
      {
        error: `Invalid mediaType. Must be one of: ${[...ALLOWED_MEDIA_TYPES].join(", ")}`,
      },
      { status: 400 },
    );
  }
  if (image.length > MAX_BASE64_BYTES) {
    return NextResponse.json(
      { error: "Image too large. Please resize to 1024px on the longest side." },
      { status: 413 },
    );
  }

  // 3. Call Claude with vision. The system prompt is cached (ephemeral, 5-minute TTL).
  //    The user turn contains the image followed by a short instruction.
  const client = new Anthropic({ apiKey });

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType as
                  | "image/jpeg"
                  | "image/png"
                  | "image/webp"
                  | "image/gif",
                data: image,
              },
            },
            {
              type: "text",
              text: "Please analyze this photo and determine the person's seasonal color palette.",
            },
          ],
        },
      ],
    });
  } catch (err) {
    // Distinguish between common Anthropic errors so the client can show useful messages.
    if (err instanceof Anthropic.AuthenticationError) {
      return NextResponse.json(
        { error: "Invalid Anthropic API key." },
        { status: 500 },
      );
    }
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Please try again in a moment." },
        { status: 429 },
      );
    }
    if (err instanceof Anthropic.BadRequestError) {
      return NextResponse.json(
        { error: "Request rejected by Anthropic.", detail: err.message },
        { status: 400 },
      );
    }
    const message = err instanceof Error ? err.message : "Unknown error.";
    return NextResponse.json(
      { error: "Analysis failed.", detail: message },
      { status: 500 },
    );
  }

  // 4. Extract the text block from Claude's response and parse its JSON content.
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    return NextResponse.json(
      { error: "Model returned no text content." },
      { status: 500 },
    );
  }
  const rawText = textBlock.text;

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(rawText));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown parse error.";
    return NextResponse.json(
      {
        error:
          "Model returned non-JSON output. This usually means the photo was unclear — please try another.",
        detail: message,
        raw: rawText,
      },
      { status: 502 },
    );
  }

  // 5. Success. Include usage metadata so we can track caching behavior during development.
  return NextResponse.json({
    analysis: parsed,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_creation_input_tokens:
        response.usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
    },
    model: response.model,
  });
}
