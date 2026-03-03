/**
 * api/github.js — Vercel Serverless Function
 * 
 * Proxies all GitHub REST API requests so GITHUB_TOKEN
 * is never exposed to the browser. Set GITHUB_TOKEN as
 * an environment variable in your Vercel project settings.
 * 
 * Accepted POST body shape:
 *   { action, owner, repo, path, content?, sha?, message? }
 *
 * Actions: "list" | "upload" | "delete"
 */

module.exports = async function handler(req, res) {
  // ── CORS headers ────────────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  // ── Token check ─────────────────────────────────────────────────────────────
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  if (!GITHUB_TOKEN) {
    return res.status(500).json({
      error: 'GITHUB_TOKEN environment variable is not set on the server.',
    });
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  const { action, owner, repo, path, content, sha, message } = req.body;

  if (!action || !owner || !repo || !path) {
    return res.status(400).json({ error: 'Missing required fields: action, owner, repo, path.' });
  }

  const baseHeaders = {
    Authorization: `token ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    'User-Agent': 'FileVault-App',
  };

  const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

  try {
    // ── LIST files ────────────────────────────────────────────────────────────
    if (action === 'list') {
      const ghRes = await fetch(apiBase, {
        method: 'GET',
        headers: baseHeaders,
      });

      const data = await ghRes.json();

      // If folder doesn't exist yet, return empty array gracefully
      if (ghRes.status === 404) {
        return res.status(200).json([]);
      }
      if (!ghRes.ok) {
        return res.status(ghRes.status).json({ error: data.message || 'GitHub API error' });
      }

      return res.status(200).json(data);
    }

    // ── UPLOAD (create or update) file ────────────────────────────────────────
    if (action === 'upload') {
      if (!content) {
        return res.status(400).json({ error: 'Missing content (base64 encoded file).' });
      }

      // Check if file already exists to get its sha (needed for update)
      let existingSha;
      try {
        const checkRes = await fetch(apiBase, { method: 'GET', headers: baseHeaders });
        if (checkRes.ok) {
          const checkData = await checkRes.json();
          existingSha = checkData.sha;
        }
      } catch (_) {
        // File doesn't exist – that's fine for a new upload
      }

      const body = {
        message: message || `Upload ${path}`,
        content,
        ...(existingSha ? { sha: existingSha } : {}),
      };

      const ghRes = await fetch(apiBase, {
        method: 'PUT',
        headers: baseHeaders,
        body: JSON.stringify(body),
      });

      const data = await ghRes.json();
      if (!ghRes.ok) {
        return res.status(ghRes.status).json({ error: data.message || 'Upload failed' });
      }

      return res.status(200).json(data);
    }

    // ── DELETE file ───────────────────────────────────────────────────────────
    if (action === 'delete') {
      if (!sha) {
        return res.status(400).json({ error: 'Missing sha for delete action.' });
      }

      const body = {
        message: message || `Delete ${path}`,
        sha,
      };

      const ghRes = await fetch(apiBase, {
        method: 'DELETE',
        headers: baseHeaders,
        body: JSON.stringify(body),
      });

      if (ghRes.status === 200 || ghRes.status === 204) {
        return res.status(200).json({ success: true });
      }

      const data = await ghRes.json();
      return res.status(ghRes.status).json({ error: data.message || 'Delete failed' });
    }

    return res.status(400).json({ error: `Unknown action: "${action}"` });

  } catch (err) {
    console.error('[FileVault API Error]', err);
    return res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
}
