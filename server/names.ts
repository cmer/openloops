const MAX_ASSISTANT_NAME = 60;

export function assistantNameFrom(raw: string | undefined): string {
  const cleaned = (raw ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!cleaned) return "Assistant";
  return Array.from(cleaned).slice(0, MAX_ASSISTANT_NAME).join("");
}
