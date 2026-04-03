const SYSTEM_PROMPT = `Restructure this spoken transcript into a clear, organized prompt for an AI assistant. Preserve all meaning and details. Use sections/headers for multiple topics, bullet points for lists. Fix grammar, remove filler words. Output only the structured prompt.`;

export interface LlmConfig {
  provider: "gemini" | "openai" | "anthropic" | "groq";
  apiKey: string;
  model?: string;
}

export interface GeminiModel {
  name: string;
  displayName: string;
}

export async function fetchGeminiModels(apiKey: string): Promise<GeminiModel[]> {
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
  );
  if (!resp.ok) return [];
  const data = await resp.json();
  return (data.models || [])
    .filter((m: { name: string; supportedGenerationMethods?: string[] }) =>
      m.supportedGenerationMethods?.includes("generateContent"),
    )
    .map((m: { name: string; displayName: string }) => ({
      name: m.name.replace("models/", ""),
      displayName: m.displayName,
    }));
}

export async function structurePrompt(
  config: LlmConfig,
  transcript: string,
): Promise<string> {
  switch (config.provider) {
    case "gemini":
      return callGemini(config, transcript);
    case "openai":
      return callOpenAI(config, transcript);
    case "anthropic":
      return callAnthropic(config, transcript);
    case "groq":
      return callGroq(config, transcript);
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

async function callOpenAI(
  config: LlmConfig,
  transcript: string,
): Promise<string> {
  const model = config.model || "gpt-4o-mini";
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: transcript },
      ],
      temperature: 0.3,
    }),
  });

  if (!resp.ok) {
    throw new Error(`OpenAI error ${resp.status}: ${await resp.text()}`);
  }

  const data = await resp.json();
  return data.choices[0].message.content;
}

async function callAnthropic(
  config: LlmConfig,
  transcript: string,
): Promise<string> {
  const model = config.model || "claude-sonnet-4-20250514";
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: transcript }],
    }),
  });

  if (!resp.ok) {
    throw new Error(`Anthropic error ${resp.status}: ${await resp.text()}`);
  }

  const data = await resp.json();
  return data.content[0].text;
}

async function callGroq(
  config: LlmConfig,
  transcript: string,
): Promise<string> {
  const model = config.model || "llama-3.1-8b-instant";
  const resp = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: transcript },
        ],
        temperature: 0.3,
      }),
    },
  );

  if (!resp.ok) {
    throw new Error(`Groq error ${resp.status}: ${await resp.text()}`);
  }

  const data = await resp.json();
  return data.choices[0].message.content;
}

async function callGemini(
  config: LlmConfig,
  transcript: string,
): Promise<string> {
  const model = config.model || "gemini-2.5-flash";

  const makeRequest = async () => {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ parts: [{ text: transcript }] }],
          generationConfig: { temperature: 0.3 },
        }),
      },
    );
    return resp;
  };

  let resp = await makeRequest();

  // Retry once on rate limit after a short wait
  if (resp.status === 429) {
    await new Promise((r) => setTimeout(r, 5000));
    resp = await makeRequest();
  }

  if (!resp.ok) {
    if (resp.status === 429) {
      throw new Error(
        "Rate limit reached. The shared key has limited usage. Add your own free Gemini API key in Settings for unlimited access.",
      );
    }
    const text = await resp.text();
    throw new Error(`Gemini error ${resp.status}: ${text.slice(0, 200)}`);
  }

  const data = await resp.json();
  return data.candidates[0].content.parts[0].text;
}
