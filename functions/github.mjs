// github.mjs — minimal GitHub REST client for the CMS function (fetch-only,
// no SDK). Scope of the token: classic public_repo PAT (no workflow scope) on
// a non-admin machine account whose only write access is this one repo — see
// docs/cms.md step 4 for why it can't be fine-grained. Even fully compromised,
// the function can't bypass branch protection or reach other repos.

const API = 'https://api.github.com';

export function createGithub({ token, owner, repo }) {
  async function gh(method, path, body) {
    const res = await fetch(`${API}/repos/${owner}/${repo}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'noprofits-cms',
        'x-github-api-version': '2022-11-28',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 404) return { status: 404, data: null };
    const data = res.status === 204 ? null : await res.json();
    if (!res.ok) {
      const err = new Error(`GitHub ${method} ${path} → ${res.status}: ${data && data.message}`);
      err.status = res.status;
      throw err;
    }
    return { status: res.status, data };
  }

  return {
    async branchSha(branch) {
      const { status, data } = await gh('GET', `/git/ref/${encodeURIComponent('heads/' + branch)}`);
      return status === 404 ? null : data.object.sha;
    },

    async createBranch(branch, fromSha) {
      await gh('POST', '/git/refs', { ref: `refs/heads/${branch}`, sha: fromSha });
    },

    // All .astro files under src/pages on a ref → [{ path, sha }]
    async listPages(ref) {
      const { data } = await gh('GET', `/git/trees/${encodeURIComponent(ref)}?recursive=1`);
      return data.tree
        .filter((e) => e.type === 'blob'
          && e.path.startsWith('src/pages/')
          && e.path.endsWith('.astro')
          && !e.path.split('/').some((seg) => seg.startsWith('_')))
        .map((e) => ({ path: e.path, sha: e.sha }));
    },

    // File content + blob sha on a ref (contents API).
    async getFile(path, ref) {
      const { status, data } = await gh('GET',
        `/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`);
      if (status === 404) return null;
      return {
        sha: data.sha,
        text: Buffer.from(data.content, 'base64').toString('utf8'),
      };
    },

    // Commit new content to a branch. GitHub itself enforces the concurrency
    // guard: `sha` must match the file's current blob sha on that branch or
    // the API returns 409.
    async putFile(path, { text, sha, branch, message, author }) {
      const { data } = await gh('PUT',
        `/contents/${path.split('/').map(encodeURIComponent).join('/')}`, {
          message,
          content: Buffer.from(text, 'utf8').toString('base64'),
          sha,
          branch,
          ...(author ? { committer: { name: author.name, email: author.email } } : {}),
        });
      return { newSha: data.content.sha, commit: data.commit.sha };
    },

    async findOpenPr(headBranch, base) {
      const { data } = await gh('GET',
        `/pulls?state=open&head=${encodeURIComponent(owner + ':' + headBranch)}&base=${encodeURIComponent(base)}`);
      return data && data.length ? { number: data[0].number, url: data[0].html_url } : null;
    },

    async createPr(headBranch, base, title, body) {
      const { data } = await gh('POST', '/pulls', { head: headBranch, base, title, body });
      return { number: data.number, url: data.html_url };
    },
  };
}
