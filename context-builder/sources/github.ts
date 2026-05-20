import { logError } from "../errors";

export interface GitHubRepo {
  id: string; // "owner/repo"
  name: string;
  description: string | null;
  language: string | null;
  pushedAt: string | null;
  readme: string | null;
  recentCommits: string[];
  isPrivate: boolean;
}

async function ghFetch(path: string, token: string): Promise<unknown> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${path}: ${res.status}`);
  return res.json();
}

export async function fetchGitHubRepos(token: string): Promise<GitHubRepo[]> {
  try {
    const repos = await ghFetch("/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator", token) as {
      full_name: string;
      name: string;
      description: string | null;
      language: string | null;
      pushed_at: string | null;
      private: boolean;
    }[];

    const results: GitHubRepo[] = [];

    for (const repo of repos.slice(0, 50)) {
      let readme: string | null = null;
      let recentCommits: string[] = [];

      try {
        const readmeData = await ghFetch(`/repos/${repo.full_name}/readme`, token) as { content?: string; encoding?: string };
        if (readmeData.content && readmeData.encoding === "base64") {
          const decoded = atob(readmeData.content.replace(/\n/g, ""));
          readme = decoded.slice(0, 400);
        }
      } catch {}

      try {
        const commits = await ghFetch(`/repos/${repo.full_name}/commits?per_page=10`, token) as { commit: { message: string } }[];
        recentCommits = commits.map((c) => c.commit.message.split("\n")[0].slice(0, 80));
      } catch {}

      results.push({
        id: repo.full_name,
        name: repo.name,
        description: repo.description,
        language: repo.language,
        pushedAt: repo.pushed_at,
        readme,
        recentCommits,
        isPrivate: repo.private,
      });
    }

    return results;
  } catch (err) {
    await logError("github", err);
    return [];
  }
}
