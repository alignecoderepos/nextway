import type { MiddlewareHandler } from "hono";
import {
  ComprehendClient,
  DetectPiiEntitiesCommand,
} from "@aws-sdk/client-comprehend";
import { getConfig } from "../../config.js";

interface DetectionResult {
  entities: string[];
}

export interface GuardrailDetectionLog {
  type: "data_privacy";
  stage: "request" | "response";
  labels: string[];
}

async function detectPii(
  client: ComprehendClient,
  text: string,
): Promise<DetectionResult> {
  if (!text.trim()) return { entities: [] };
  try {
    const res = await client.send(
      new DetectPiiEntitiesCommand({ Text: text, LanguageCode: "en" }),
    );
    const entities = (res.Entities || [])
      .map((e) => e.Type)
      .filter(Boolean) as string[];
    return { entities };
  } catch (err) {
    console.error("Guardrails detection error:", err);
    return { entities: [] };
  }
}

export function guardrails(): MiddlewareHandler {
  const config = getConfig().guardrails.data_privacy;
  if (!config.enabled) {
    return async (_, next) => {
      await next();
    };
  }

  const client = new ComprehendClient({
    region: config.aws_region,
    credentials: {
      accessKeyId: process.env[config.access_key_id_env] || "",
      secretAccessKey: process.env[config.secret_access_key_env] || "",
    },
  });

  const mode = config.mode;

  return async (c, next) => {
    const detections =
      (c.get("guardrail_detections") as GuardrailDetectionLog[] | undefined) ||
      [];
    c.set("guardrail_detections", detections);
    const reqClone = (c.req as any).raw?.clone
      ? (c.req as any).raw.clone()
      : (c.req as any).clone();
    const reqText = await reqClone.text();
    const reqDetection = await detectPii(client, reqText);
    if (reqDetection.entities.length) {
      console.warn(
        `Guardrails request entities: ${reqDetection.entities.join(", ")}`,
      );
      detections.push({
        type: "data_privacy",
        stage: "request",
        labels: reqDetection.entities,
      });
      if (mode === "block") {
        return c.json(
          {
            error: {
              message: "PII detected in request",
              type: "guardrails_violation",
              code: "PII_DETECTED",
            },
          },
          400,
        );
      }
    }

    await next();

    const contentType = c.res.headers.get("content-type") || "";
    if (!contentType.includes("text/event-stream")) {
      const resClone = c.res.clone();
      const resText = await resClone.text();
      const resDetection = await detectPii(client, resText);
      if (resDetection.entities.length) {
        console.warn(
          `Guardrails response entities: ${resDetection.entities.join(", ")}`,
        );
        detections.push({
          type: "data_privacy",
          stage: "response",
          labels: resDetection.entities,
        });
        if (mode === "block") {
          c.res = new Response(
            JSON.stringify({
              error: {
                message: "PII detected in response",
                type: "guardrails_violation",
                code: "PII_DETECTED",
              },
            }),
            { status: 502, headers: { "Content-Type": "application/json" } },
          );
          return;
        }
      }
    }
  };
}
