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
const $$ = (q) => document.querySelectorAll(q);
const loginBtn = $('#loginBtn');
const alertEl  = $('#alert');
const statusEl = $('#status');
const resultEl = $('#result');
const histEl   = $('#history');
const spin     = $('#spin');
const submitBtn= $('#submitBtn');
const walletListEl = $('#walletList');
const walletActionsEl = $('#walletActions');

/* ---------- 状态 ---------- */
let JWT    = localStorage.getItem('walletJWT')  || null;
let WALLET = localStorage.getItem('walletAddr') || null;
let selectedWallets = new Set();

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
  loadWallets();
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
    renderLogin(); hideAlert(); loadHist(); loadWallets();
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
    statusEl.innerHTML = `✅ 已生成 ${d.count} 个 —— <a href="#" onclick="downloadJob('${d.job_id}'); return false;">下载 Zip</a>`;
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
        `<tr><td>${i + 1}</td><td>${new Date(x.created).toLocaleString()}</td><td>${x.count}</td><td><a href="#" onclick="downloadJob('${x.job_id}'); return false;">下载</a></td></tr>`
      ).join('') + '</tbody></table>'
    : '<p class="muted">暂无记录</p>';
};

/* ---------- 钱包管理 ---------- */
const loadWallets = async () => {
  if (!JWT) { 
    walletListEl.innerHTML = '<p class="muted">请先登录</p>';
    walletActionsEl.style.display = 'none';
    return; 
  }
  
  walletActionsEl.style.display = 'block';
  const r = await authFetch('/api/wallets');
  if (!r.ok) return;
  
  const wallets = await r.json();
  
  if (wallets.length === 0) {
    walletListEl.innerHTML = '<p class="muted">暂无钱包，请导入或生成钱包</p>';
    return;
  }
  
  walletListEl.innerHTML = `
    <table>
      <thead>
        <tr>
          <th><input type="checkbox" id="selectAll"></th>
          <th>钱包地址</th>
          <th>名称</th>
          <th>来源</th>
          <th>余额 (SOL)</th>
          <th>创建时间</th>
        </tr>
      </thead>
      <tbody>
        ${wallets.map(w => `
          <tr>
            <td><input type="checkbox" class="wallet-select" value="${w.id}"></td>
            <td>${w.public_key}</td>
            <td><span class="wallet-name" data-id="${w.id}">${w.name || '-'}</span></td>
            <td>${w.source}</td>
            <td>${w.balance !== null ? w.balance.toFixed(4) : '-'}</td>
            <td>${new Date(w.created).toLocaleString()}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  
  // 全选功能
  $('#selectAll').onchange = (e) => {
    $$('.wallet-select').forEach(cb => cb.checked = e.target.checked);
    updateSelectedWallets();
  };
  
  // 单选功能
  $$('.wallet-select').forEach(cb => {
    cb.onchange = updateSelectedWallets;
  });

  // 编辑名称
  $$('.wallet-name').forEach(span => {
    span.onclick = async () => {
      const id = span.dataset.id;
      const current = span.textContent === '-' ? '' : span.textContent;
      const name = prompt('输入新的名称', current);
      if (name === null) return;
      try {
        const r = await authFetch(`/api/wallets/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name })
        });
        if (!r.ok) throw new Error('更新失败');
        span.textContent = name || '-';
      } catch (e) {
        alertMsg(e.message);
      }
    };
  });
};

const updateSelectedWallets = () => {
  selectedWallets.clear();
  $$('.wallet-select:checked').forEach(cb => {
    selectedWallets.add(parseInt(cb.value));
  });
  
  // 更新按钮状态
  $('#exportBtn').disabled = selectedWallets.size === 0;
  $('#balanceBtn').disabled = selectedWallets.size === 0;
  $('#deleteBtn').disabled = selectedWallets.size === 0;
};

// 导入钱包弹窗逻辑
const importModal = $('#importModal');
const importTextarea = $('#importTextarea');
const importConfirm = $('#importConfirm');
const importCancel = $('#importCancel');

$('#importBtn').onclick = () => {
  importModal.hidden = false;
};

importCancel.onclick = () => {
  importModal.hidden = true;
  importTextarea.value = '';
};

// 拖拽文件读取
importTextarea.addEventListener('dragover', (e) => {
  e.preventDefault();
});

importTextarea.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    importTextarea.value = reader.result;
  };
  reader.readAsText(file);
});

importConfirm.onclick = async () => {
  const text = importTextarea.value.trim();
  if (!text) { alertMsg('请输入或拖入私钥'); return; }

  const blob = new Blob([text], { type: 'application/json' });
  const formData = new FormData();
  formData.append('file', blob, 'import.json');

  try {
    const r = await authFetch('/api/wallets/import', {
      method: 'POST',
      body: formData
    });

    if (!r.ok) {
      const err = await r.json();
      throw new Error(err.detail || '导入失败');
    }

    const result = await r.json();
    alert(`导入成功！\n成功: ${result.imported} 个\n失败: ${result.failed} 个`);
    loadWallets();
    importModal.hidden = true;
    importTextarea.value = '';
  } catch (e) {
    alertMsg(`导入失败: ${e.message}`);
  }
};

// 导出钱包
$('#exportBtn').onclick = async () => {
  if (selectedWallets.size === 0) {
    alertMsg('请选择要导出的钱包');
    return;
  }
  
  try {
    const r = await authFetch('/api/wallets/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Array.from(selectedWallets))  // 直接发送数组
    });
    
    if (!r.ok) throw new Error('导出失败');
    
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wallets_export_${selectedWallets.size}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alertMsg(`导出失败: ${e.message}`);
  }
};

// 查询余额
$('#balanceBtn').onclick = async () => {
  if (selectedWallets.size === 0) {
    alertMsg('请选择要查询的钱包');
    return;
  }
  
  const balanceBtn = $('#balanceBtn');
  const totalBalanceBox = $('#totalBalanceBox');
  
  balanceBtn.disabled = true;
  balanceBtn.textContent = '查询中...';
  totalBalanceBox.classList.add('loading');
  
  try {
    const r = await authFetch('/api/wallets/balances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Array.from(selectedWallets))
    });
    
    if (!r.ok) throw new Error('查询失败');
    
    const result = await r.json();
    
    // 更新总余额显示
    $('#totalBalance').textContent = result.total.toFixed(4);
    $('#walletCount').textContent = result.count;
    $('#lastUpdate').textContent = new Date().toLocaleTimeString();
    totalBalanceBox.style.display = 'block';
    totalBalanceBox.classList.remove('loading');
    
    // 重新加载钱包列表以显示更新的余额
    await loadWallets();
    
    // 恢复选中状态
    selectedWallets.forEach(id => {
      const checkbox = document.querySelector(`.wallet-select[value="${id}"]`);
      if (checkbox) checkbox.checked = true;
    });
    
  } catch (e) {
    alertMsg(`查询失败: ${e.message}`);
    totalBalanceBox.classList.remove('loading');
  } finally {
    balanceBtn.disabled = false;
    balanceBtn.textContent = '💰 查询余额';
  }
};

// 删除钱包
$('#deleteBtn').onclick = async () => {
  if (selectedWallets.size === 0) {
    alertMsg('请选择要删除的钱包');
    return;
  }
  
  if (!confirm(`确定要删除 ${selectedWallets.size} 个钱包吗？此操作不可恢复！`)) {
    return;
  }
  
  try {
    const r = await authFetch('/api/wallets', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Array.from(selectedWallets))  // 直接发送数组
    });
    
    if (!r.ok) throw new Error('删除失败');
    
    const result = await r.json();
    alert(`成功删除 ${result.deleted} 个钱包`);
    loadWallets();
  } catch (e) {
    alertMsg(`删除失败: ${e.message}`);
  }
};

/* ---------- 下载功能 ---------- */
window.downloadJob = async (jobId) => {
  try {
    const r = await authFetch(`/download/${jobId}`);
    if (!r.ok) throw new Error('下载失败');
    
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wallet_job_${jobId}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alertMsg(`下载失败: ${e.message}`);
  }
};

/* ---------- 初始化 ---------- */
renderLogin();
if (JWT) {
  loadHist();
  loadWallets();
}