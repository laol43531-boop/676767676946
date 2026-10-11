/**
 * ImageDrop 中转服务（Cloudflare Worker）
 * ------------------------------------------------------------
 * 作用：替"没有 GitHub Token 的访客"把文件写进你的仓库，
 *       然后再返回 jsDelivr 直链。访客完全不需要 Token。
 *
 * 部署步骤（全程免费、不用信用卡）：
 *   1. 打开 https://workers.cloudflare.com/ 注册/登录；
 *   2. Create application → Create Worker → 起个名字 → Deploy；
 *   3. 点 Edit code，把本文件全部内容粘进去，覆盖原示例 → Save and Deploy；
 *   4. 进入 Settings → Variables，添加以下环境变量（建议类型选 Secret / 加密）：
 *        GH_TOKEN = <在这里填你的-GitHub-PAT>
 *        PASS     = 你自己定一个口令（例如 mySecret2024）  ← 不填则任何人可传，建议填
 *        （可选）OWNER / REPO / BRANCH / DIR 默认已内置，可不填
 *   5. 复制你的 Worker 地址（形如 https://xxxx.xxxx.workers.dev），
 *      粘贴到 ImageDrop 网页的 ⚙️ 设置 → 中转 里，再填上同一个口令，保存即可。
 * ------------------------------------------------------------
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, CORS),
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'POST') return json({ error: '只接受 POST' }, 405);

    let body;
    try { body = await request.json(); }
    catch (e) { return json({ error: '请求体不是合法 JSON' }, 400); }

    // 口令校验（若设置了 PASS）
    if (env.PASS && body.pass !== env.PASS) return json({ error: '访问口令不正确' }, 401);

    const name = String(body.name || '').trim();
    const content = body.content;
    if (!name || !content) return json({ error: '缺少 name 或 content' }, 400);
    // 限制大小（jsDelivr 单文件约 20MB 上限）
    if (content.length > 28 * 1024 * 1024) return json({ error: '文件太大（超过约 20MB 限制）' }, 413);

    // 只允许安全字符，防止路径穿越
    const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_');

    const owner  = env.OWNER  || 'laol43531-boop';
    const repo   = env.REPO   || '676767676946';
    const branch = env.BRANCH || 'main';
    const dir    = env.DIR    || 'images';
    const token  = env.GH_TOKEN;
    if (!token) return json({ error: '服务端未配置 GH_TOKEN' }, 500);

    const path = dir + '/' + safe;
    const api = 'https://api.github.com/repos/' + owner + '/' + repo + '/contents/' + path;

    const ghHeaders = {
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'picdrop-relay',
    };

    // 若仓库里已存在同名文件，需要带 sha 才能覆盖
    let sha = null;
    try {
      const head = await fetch(api + '?ref=' + branch, { headers: ghHeaders });
      if (head.status === 200) {
        const j = await head.json();
        sha = j.sha;
      }
    } catch (e) { /* 忽略：新文件本来就不存在 */ }

    const putBody = { message: 'upload ' + safe, content: content, branch: branch };
    if (sha) putBody.sha = sha;

    const put = await fetch(api, {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, ghHeaders),
      body: JSON.stringify(putBody),
    });

    const txt = await put.text();
    if (!put.ok) {
      let msg = 'HTTP ' + put.status;
      try { msg += ' · ' + (JSON.parse(txt).message || ''); } catch (e) {}
      return json({ error: '写入 GitHub 失败：' + msg }, 502);
    }

    const url = 'https://cdn.jsdelivr.net/gh/' + owner + '/' + repo + '@' + branch + '/' + path;
    return json({ ok: true, url: url });
  },
};
