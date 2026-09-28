// The GitHub jobs refresh injuries, player notes and weekly projections, but the live site only
// changes when it is republished from Lovable. So the app reads the newest copy of those files
// straight from the (public) GitHub repo, and falls back to the copy published with the site.
const GITHUB_RAW = "https://raw.githubusercontent.com/partyeh-git/opportunity-lab/main/";

export async function fetchLiveJson<T>(
  repoPath: string,
  fallback: () => Promise<T>,
  isValid: (data: T) => boolean = () => true,
): Promise<T> {
  try {
    const response = await fetch(GITHUB_RAW + repoPath);
    if (response.ok) {
      const data = (await response.json()) as T;
      if (isValid(data)) return data;
    }
  } catch {
    // GitHub unreachable: use the published copy.
  }
  return fallback();
}

/** A file in public/: newest from GitHub, else the site's own copy; missing everywhere -> null. */
export function fetchPublicJson<T>(path: string): Promise<T | null> {
  return fetchLiveJson<T | null>(`public/${path}`, async () => {
    const response = await fetch(`/${path}`);
    return response.ok ? ((await response.json()) as T) : null;
  });
}
