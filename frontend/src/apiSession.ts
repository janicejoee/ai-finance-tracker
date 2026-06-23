let cachedInsight: string | null = null;
let insightInflight: Promise<string | null> | null = null;

export function hasCachedInsight(): boolean {
  return cachedInsight !== null;
}

export async function fetchInsight(
  force = false,
  signal?: AbortSignal
): Promise<string | null> {
  if (!force && cachedInsight !== null) {
    return cachedInsight;
  }

  if (!force && insightInflight) {
    return insightInflight;
  }

  if (force) {
    cachedInsight = null;
  }

  const request = fetch("/api/insights", { signal })
    .then(async (response) => {
      const data = await response.json();
      if (!response.ok || typeof data.insight !== "string") {
        return null;
      }
      cachedInsight = data.insight;
      return data.insight;
    })
    .finally(() => {
      insightInflight = null;
    });

  insightInflight = request;
  return request;
}
