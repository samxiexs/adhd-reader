import type { BlockAnnotation, ReadingBlock } from "./contracts";
import { validateAnnotations } from "./contracts";

type ProviderDefinition = {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  apiKeyEnv: string;
};

export type PublicProvider = Pick<ProviderDefinition, "id" | "label" | "model">;

function environment() {
  return typeof process === "undefined" ? {} : process.env;
}

function configuredProviders(): ProviderDefinition[] {
  const env = environment();
  const raw = env.AI_PROVIDERS_JSON;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item): item is Partial<ProviderDefinition> => !!item && typeof item === "object")
          .filter(
            (item) =>
              typeof item.id === "string" &&
              typeof item.label === "string" &&
              typeof item.baseUrl === "string" &&
              typeof item.model === "string" &&
              typeof item.apiKeyEnv === "string",
          )
          .map((item) => item as ProviderDefinition);
      }
    } catch {
      return [];
    }
  }

  if (env.OPENAI_API_KEY) {
    return [
      {
        id: "openai",
        label: "OpenAI",
        baseUrl: env.OPENAI_BASE_URL || "https://api.openai.com/v1",
        model: env.OPENAI_MODEL || "gpt-4.1-mini",
        apiKeyEnv: "OPENAI_API_KEY",
      },
    ];
  }
  return [];
}

export function listPublicProviders(): PublicProvider[] {
  const env = environment();
  return configuredProviders()
    .filter((provider) => Boolean(env[provider.apiKeyEnv]))
    .map(({ id, label, model }) => ({ id, label, model }));
}

function parseJsonContent(content: string) {
  const trimmed = content.trim().replace(/^```json\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(trimmed) as { blocks?: unknown };
}

export async function requestAiAnnotations(
  blocks: ReadingBlock[],
  providerId: string | undefined,
): Promise<BlockAnnotation[]> {
  const env = environment();
  const provider = configuredProviders().find((item) => item.id === providerId) ?? configuredProviders()[0];
  if (!provider || !env[provider.apiKeyEnv]) {
    throw new Error("未配置可用的 AI 服务。请改用本地模式，或在部署环境中设置服务商密钥。");
  }

  const response = await fetch(`${provider.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env[provider.apiKeyEnv]}`,
    },
    body: JSON.stringify({
      model: provider.model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You prepare attention-friendly reading layouts. You must never rewrite, translate, omit, add, reorder, or return source text. Return only strict JSON annotation data.",
        },
        {
          role: "user",
          content: JSON.stringify({
            task:
              "For every block, choose zero to three short, meaningful phrases to emphasize. Use UTF-16 character offsets into that block's exact text. Include every supplied id exactly once and in the same order. Do not return prose or source text.",
            schema: {
              blocks: [
                {
                  id: "same input id",
                  highlights: [{ start: 0, end: 1 }],
                },
              ],
            },
            blocks: blocks.map(({ id, text, kind }) => ({ id, kind, text })),
          }),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`AI 服务暂时不可用（${response.status}）。`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI 服务没有返回可用结果。");
  return validateAnnotations(blocks, parseJsonContent(content).blocks);
}
