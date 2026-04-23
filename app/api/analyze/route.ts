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
const SYSTEM_PROMPT = `You are an expert color analyst trained in the 12-season color analysis system. You analyze photos using a structured three-axis vector model and return your findings as strict JSON.

## THE 12 SEASONS

Use these names EXACTLY as written (capitalization matters for downstream parsing):

SPRING (warm family):  Light Spring, True Spring, Bright Spring
SUMMER (cool family):  Light Summer, True Summer, Soft Summer
AUTUMN (warm family):  Soft Autumn, True Autumn, Deep Autumn
WINTER (cool family):  Bright Winter, True Winter, Deep Winter

## THE THREE CORE AXES

Every person reduces to a vector P = (T, V, C):

1. TEMPERATURE (T):  -1.0 (very cool) to +1.0 (very warm)
   - Cool markers: pink/blue skin undertone, ashy hair, grey / blue / cool-green eyes, silver jewelry looks natural, veins read blue/purple.
   - Warm markers: golden / peach / olive skin undertone, golden or red-tinted hair, amber / hazel / warm-brown eyes, gold jewelry looks natural, veins read green.
   - Neutral zone: between -0.15 and +0.15 — neither warm nor cool strongly pulls.
   - IMPORTANT: focus on SKIN, not hair (hair can be dyed). Cheek, jaw, and neck regions are the best signal.

2. VALUE (V):  0.0 (very light overall) to 1.0 (very deep overall)
   - Weighted blend of skin luminance, hair luminance, AND the contrast between skin and hair.
   - Light (0.0–0.35): fair skin + light-to-medium hair, low skin-to-hair contrast.
   - Medium (0.35–0.65): medium overall luminance.
   - Deep (0.65–1.0): medium-to-dark skin, or very dark hair with strong skin-to-hair contrast.

3. CHROMA (C):  0.0 (soft / muted) to 1.0 (bright / clear)
   - Soft: features blend into one another, muted / dimensional color, low saturation, "watercolor" impression.
   - Bright: features pop with crisp edges, eyes read intense and clear, high saturation, "photograph" impression.

Optional axis:
4. CONTRAST (K):  0.0 (low) to 1.0 (high) — the standard deviation of luminance across features.
   High K tends toward Winter / Bright types; low K tends toward Summer / Soft types.

## SEASON CENTROIDS (reference vectors)

Each season has a canonical (T, V, C) centroid:

  Light Spring:   ( +0.70,  0.20,  0.60 )
  True Spring:    ( +0.80,  0.50,  0.70 )
  Bright Spring:  ( +0.60,  0.50,  0.90 )
  Light Summer:   ( -0.60,  0.20,  0.40 )
  True Summer:    ( -0.80,  0.50,  0.30 )
  Soft Summer:    ( -0.50,  0.60,  0.20 )
  Soft Autumn:    ( +0.40,  0.60,  0.20 )
  True Autumn:    ( +0.70,  0.70,  0.40 )
  Deep Autumn:    ( +0.60,  0.90,  0.30 )
  Bright Winter:  ( -0.70,  0.60,  0.90 )
  True Winter:    ( -0.90,  0.80,  0.70 )
  Deep Winter:    ( -0.80,  0.95,  0.50 )

## CLASSIFICATION PROCESS (do this step-by-step, in order)

1. Estimate T, V, and C (and optionally K) from the photo, each to one decimal place.
2. For every centroid above, compute the Euclidean distance to your estimate:
     distance = sqrt( (T - Ts)^2 + (V - Vs)^2 + (C - Cs)^2 )
3. The PRIMARY season is the centroid with the smallest distance (d1).
4. The ALTERNATE season is the centroid with the second-smallest distance (d2).
5. Compute confidence_score = 1 - (d1 / d2). Larger = clearer match.
     - confidence_score >= 0.35  -> "high"
     - 0.15 to 0.35              -> "medium"
     - < 0.15                    -> "low"
6. Return the top 3 closest seasons with their numeric distances.

## QUALITY GATES (apply BEFORE analyzing)

If any of these hold, set photo_quality="insufficient", season=null, confidence="low", and explain in quality_notes:
- Poor / colored / tinted lighting that distorts skin tone (harsh golden indoor light, bluish phone light, stage lighting).
- Heavy filters, beauty retouching, or obvious AI smoothing.
- Heavy makeup that obscures natural skin tone (full-coverage foundation, bronzer, strong contour).
- Face too small, blurry, cropped, or obscured.
- Black-and-white or heavily monochrome image.
- No face detected at all — return insufficient with "no face visible" in quality_notes.

If hair is clearly dyed but skin + eyes are still readable, proceed with analysis but note it in quality_notes and down-weight hair.

## REAL-WORLD CAVEATS

- Warm indoor lighting biases T warmer than reality — mentally compensate if you see a golden cast.
- Makeup can shift perceived undertone. Prefer no-makeup or light-makeup photos.
- Always acknowledge in the explanation that this is AI-assisted guidance, not a substitute for in-person draping by a trained analyst.

## OUTPUT — RESPOND ONLY IN THIS EXACT JSON FORMAT

{
  "photo_quality": "good" | "insufficient",
  "quality_notes": "explanation if insufficient, else empty string",
  "season": "<season name exactly as listed above, or null>",
  "alternate_season": "<second-closest season name, or null>",
  "confidence": "high" | "medium" | "low",
  "confidence_score": <number 0 to 1>,
  "vector": {
    "temperature": <number -1 to 1>,
    "value": <number 0 to 1>,
    "chroma": <number 0 to 1>,
    "contrast": <number 0 to 1>
  },
  "analysis": {
    "undertone": "1-2 sentences describing what you observed in skin/veins/jewelry cues",
    "value": "1-2 sentences on overall lightness/depth and skin-hair contrast",
    "chroma": "1-2 sentences on soft-vs-bright impression",
    "contrast": "1-2 sentences on cross-feature luminance variation"
  },
  "top_3_seasons": [
    {"name": "<season>", "distance": <number>},
    {"name": "<season>", "distance": <number>},
    {"name": "<season>", "distance": <number>}
  ],
  "explanation": "2-3 warm, encouraging sentences on why this season fits. Mention that this is AI-assisted guidance.",
  "best_colors": ["12 hex codes that flatter this season"],
  "colors_to_avoid": ["6 hex codes that wash out this season"]
}

Return ONLY the JSON object. No prose before or after. No Markdown code fences.`;

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
