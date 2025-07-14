/* ---------- 动态加载 bs58 ---------- */
let bs58;
const bs58Ready = new Promise(async (res) => {
  try {
    bs58 = (await import('https://cdn.jsdelivr.net/npm/bs58@5/+esm')).default;
  } catch {
    bs58 = (await import('https://unpkg.com/bs58@5/+esm')).default;
  } finally {
    res();
  }
});

/* ---------- DOM ---------- */
const $ = (q) => document.querySelector(q);
const loginBtn = $('#loginBtn');
const alertEl  = $('#alert');
const statusEl = $('#status');
const resultEl = $('#result');
const histEl   = $('#history');
const spin     = $('#spin');
const submitBtn= $('#submitBtn');

/* ---------- 状态 ---------- */
let JWT    = localStorage.getItem('walletJWT')  || null;
let WALLET = localStorage.getItem('walletAddr') || null;

/* ---------- 通用工具 ---------- */
const renderLogin = () => {
  loginBtn.textContent = JWT
    ? `已登录: ${WALLET.slice(0, 4)}…${WALLET.slice(-4)}`
    : '连接钱包 / 登录';
  loginBtn.classList.toggle('connected', !!JWT);
};

const alertMsg  = (m) => { alertEl.textContent = m; alertEl.style.display = 'block'; };
const hideAlert = () => { alertEl.style.display = 'none'; };

const logout = () => {
  JWT = WALLET = null;
  localStorage.clear();
  renderLogin();
  loadHist();
};

const authFetch = async (url, opt = {}) => {
  if (JWT) (opt.headers ??= {}).Authorization = 'Bearer ' + JWT;
  const r = await fetch(url, opt);
  if (r.status === 401) logout();
  return r;
};

/* ---------- 登录/登出 ---------- */
loginBtn.onclick = async () => {
  if (JWT) { logout(); return; }
  if (!window.solana?.isPhantom) { alert('请安装 Phantom 钱包'); return; }

  try {
    await bs58Ready;
    const { publicKey } = await window.solana.connect();
    WALLET = publicKey.toString();

    const { nonce } = await (await fetch(`/api/nonce?wallet=${WALLET}`)).json();
    const msg   = `Sign in to WalletGen\nNonce: ${nonce}`;
    const bytes = new TextEncoder().encode(msg);
    const sig   = await window.solana.signMessage(bytes);
    const sigB58 = bs58.encode(sig.signature ?? sig);

    if (bs58.decode(sigB58).length !== 64)
      throw new Error('签名长度异常');

    const body = new URLSearchParams({ wallet: WALLET, message: msg, signature: sigB58 });
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    if (!r.ok) {
      const d = (await r.json()).detail || '';
      throw new Error(`登录失败 ${d}`);
    }
    JWT = (await r.json()).token;
    localStorage.setItem('walletJWT', JWT);
    localStorage.setItem('walletAddr', WALLET);
    renderLogin(); hideAlert(); loadHist();
  } catch (e) { console.error(e); alertMsg(e.message); }
};

loginBtn.onmouseenter = () => { if (JWT) loginBtn.textContent = 'Log out'; };
loginBtn.onmouseleave = renderLogin;

/* ---------- 批量生成 ---------- */
$('#genForm').onsubmit = async (e) => {
  e.preventDefault();
  if (!JWT) { alertMsg('请先登录'); return; }

  const fd = Object.fromEntries(new FormData(e.target).entries());
  if (+fd.min_delay > +fd.max_delay) { alertMsg('最小间隔不能大于最大间隔'); return; }

  spin.hidden = false; submitBtn.disabled = true; hideAlert();
  statusEl.textContent = '⏳ 生成中…'; resultEl.innerHTML = '';

  try {
    const r = await authFetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fd)
    });
    if (!r.ok) throw new Error(`服务器返回 ${r.status}`);
    const d = await r.json();
    statusEl.innerHTML = `✅ 已生成 ${d.count} 个 —— <a href="/download/${d.job_id}">下载 Zip</a>`;
    renderPubkeys(d.pubkeys); loadHist();
  } catch (e) { alertMsg(e.message); }
  finally { spin.hidden = true; submitBtn.disabled = false; }
};

const renderPubkeys = (arr) => {
  resultEl.innerHTML =
    '<table><thead><tr><th>#</th><th>Public Key</th><th></th></tr></thead><tbody>' +
    arr.map((pk, i) => `<tr><td>${i + 1}</td><td>${pk}</td><td><button class="copy" data-pk="${pk}">📋</button></td></tr>`).join('') +
    '</tbody></table>';
};

resultEl.addEventListener('click', (e) => {
  if (e.target.classList.contains('copy')) {
    navigator.clipboard.writeText(e.target.dataset.pk).then(() => {
      e.target.textContent = '✔️';
      setTimeout(() => e.target.textContent = '📋', 1200);
    });
  }
});

/* ---------- 历史 ---------- */
const loadHist = async () => {
  if (!JWT) { histEl.innerHTML = ''; return; }
  const r = await authFetch('/api/jobs'); if (!r.ok) return;
  const j = await r.json();
  histEl.innerHTML = j.length
    ? '<table><thead><tr><th>#</th><th>时间</th><th>数量</th><th>操作</th></tr></thead><tbody>' +
      j.map((x, i) =>
        `<tr><td>${i + 1}</td><td>${new Date(x.created).toLocaleString()}</td><td>${x.count}</td><td><a href="/download/${x.job_id}">下载</a></td></tr>`
      ).join('') + '</tbody></table>'
    : '<p class="muted">暂无记录</p>';
};

/* ---------- 初始化 ---------- */
renderLogin(); if (JWT) loadHist();
