export type ImagePayload =
  | { kind: "raster"; mimeType: string; base64: string }
  | { kind: "svg"; svgSource: string };

export interface AltTextInput {
  contextText: string;
  image: ImagePayload;
}

export interface AltTextOutput {
  decorative: boolean;
  altText: string;
  model: string;
}

export interface AltTextProvider {
  id: string;
  supportsMimeType(mimeType: string): boolean;
  generate(input: AltTextInput): Promise<{ decorative: boolean; alt: string }>;
}

export const ALT_TEXT_INSTRUCTIONS = `You write HTML alt text for web accessibility (WCAG 1.1.1).
Rules:
- Describe only what is actually visible in the image and relevant to its purpose on this page. Never invent names, places, brands, numbers or details that are not visible in the image or stated in the page context.
- If the image contains meaningful text (logo, banner, chart title), include that text.
- If the image is a logo, use the brand/organisation name (e.g. "Tripadvisor"), adding "logo" only if helpful.
- If the image is inside a link, describe the link's purpose rather than the picture.
- Keep it concise: one short phrase or sentence, ideally under 125 characters. No trailing period for short phrases.
- Do not start with "image of", "picture of", "photo of" or similar.
- If the image is purely decorative (spacer, divider, ornamental shape, background texture, or it duplicates adjacent text), set decorative to true and alt to an empty string.
Respond with JSON only: {"decorative": boolean, "alt": string}.`;

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"];

function geminiProvider(apiKey: string): AltTextProvider {
  return {
    id: `gemini:${GEMINI_MODEL}`,
    supportsMimeType: (mime) => GEMINI_MIME_TYPES.includes(mime),
    async generate({ contextText, image }) {
      const parts: unknown[] = [{ text: `Page context:\n${contextText}` }];
      if (image.kind === "raster") {
        parts.push({ inline_data: { mime_type: image.mimeType, data: image.base64 } });
      } else {
        parts.push({ text: `The image is an SVG. Its source code:\n${image.svgSource}` });
      }

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
        {
          method: "POST",
          signal: AbortSignal.timeout(30000),
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: ALT_TEXT_INSTRUCTIONS }] },
            contents: [{ role: "user", parts }],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 256,
              responseMimeType: "application/json",
              responseSchema: {
                type: "OBJECT",
                properties: {
                  decorative: { type: "BOOLEAN" },
                  alt: { type: "STRING" },
                },
                required: ["decorative", "alt"],
              },
              thinkingConfig: { thinkingBudget: 0 },
            },
          }),
        },
      );
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`Gemini request failed (${res.status}): ${detail.slice(0, 300)}`);
      }
      const data = await res.json();
      const text = (data?.candidates?.[0]?.content?.parts ?? [])
        .map((p: { text?: string }) => p.text ?? "")
        .join("");
      return JSON.parse(text || "{}");
    },
  };
}

// Providers are tried in order; add further providers (e.g. OpenRouter) to this list.
export function getProviders(): AltTextProvider[] {
  const providers: AltTextProvider[] = [];
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (geminiKey) providers.push(geminiProvider(geminiKey));
  return providers;
}

export function anyProviderSupports(providers: AltTextProvider[], mimeType: string): boolean {
  return providers.some((p) => p.supportsMimeType(mimeType));
}

function normalize(raw: { decorative: unknown; alt: unknown }): { decorative: boolean; altText: string } {
  if (typeof raw?.decorative !== "boolean" || typeof raw?.alt !== "string") {
    throw new Error("AI returned an unexpected response");
  }
  if (raw.decorative) return { decorative: true, altText: "" };
  const altText = raw.alt.replace(/"/g, "'").replace(/\s+/g, " ").trim().slice(0, 250);
  if (!altText) throw new Error("AI returned empty alt text");
  return { decorative: false, altText };
}

export async function generateAltText(providers: AltTextProvider[], input: AltTextInput): Promise<AltTextOutput> {
  let lastError: unknown = new Error("No AI provider configured");
  for (const provider of providers) {
    if (input.image.kind === "raster" && !provider.supportsMimeType(input.image.mimeType)) continue;
    try {
      const result = normalize(await provider.generate(input));
      return { ...result, model: provider.id };
    } catch (err) {
      console.error(`Alt text provider ${provider.id} failed:`, err);
      lastError = err;
    }
  }
  throw lastError;
}
