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

// 页面相关
const pages = {
  generate: $('#generatePage'),
  manage: $('#managePage'),
  buy: $('#buyPage')
};

// 导航相关
const navLinks = $$('.nav-link');
const loginBtn = $('#loginBtn');

// 通用元素
const alertEl = $('#alert');

// 生成页面元素
const genForm = $('#genForm');
const submitBtn = $('#submitBtn');
const spin = $('#spin');
const statusEl = $('#status');
const resultEl = $('#result');
const resultSection = $('#resultSection');
const histEl = $('#history');

// 管理页面元素
const walletListEl = $('#walletList');
const walletActionsEl = $('#walletActions');
const totalBalanceBox = $('#totalBalanceBox');

// 弹窗元素
const importModal = $('#importModal');
const importTextarea = $('#importTextarea');
const importConfirm = $('#importConfirm');
const importCancel = $('#importCancel');
const modalClose = $('#modalClose');

/* ---------- 状态 ---------- */
let JWT = localStorage.getItem('walletJWT') || null;
let WALLET = localStorage.getItem('walletAddr') || null;
let selectedWallets = new Set();
let currentPage = 'generate';

/* ---------- 页面切换 ---------- */
const showPage = (pageName) => {
  // 隐藏所有页面
  Object.values(pages).forEach(page => {
    page.classList.remove('active');
  });
  
  // 显示目标页面
  if (pages[pageName]) {
    pages[pageName].classList.add('active');
    currentPage = pageName;
    
    // 更新导航状态
    navLinks.forEach(link => {
      link.classList.remove('active');
      if (link.dataset.page === pageName) {
        link.classList.add('active');
      }
    });
    
    // 页面特定初始化
    if (pageName === 'manage' && JWT) {
      loadWallets();
    } else if (pageName === 'generate' && JWT) {
      loadHist();
    }
  }
};

// 导航点击事件
navLinks.forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const page = link.dataset.page;
    showPage(page);
  });
});

/* ---------- 通用工具 ---------- */
const renderLogin = () => {
  loginBtn.textContent = JWT
    ? `已登录: ${WALLET.slice(0, 4)}…${WALLET.slice(-4)}`
    : '连接钱包 / 登录';
  loginBtn.classList.toggle('connected', !!JWT);
};

const alertMsg = (m) => { 
  alertEl.textContent = m; 
  alertEl.style.display = 'block'; 
  // 5秒后自动隐藏
  setTimeout(hideAlert, 5000);
};

const hideAlert = () => { 
  alertEl.style.display = 'none'; 
};

const logout = () => {
  JWT = WALLET = null;
  localStorage.clear();
  renderLogin();
  
  // 清空页面数据
  if (currentPage === 'generate') {
    loadHist();
  } else if (currentPage === 'manage') {
    loadWallets();
  }
};

const authFetch = async (url, opt = {}) => {
  if (JWT) (opt.headers ??= {}).Authorization = 'Bearer ' + JWT;
  const r = await fetch(url, opt);
  if (r.status === 401) logout();
  return r;
};

/* ---------- 登录/登出 ---------- */
loginBtn.onclick = async () => {
  if (JWT) { 
    logout(); 
    return; 
  }
  
  if (!window.solana?.isPhantom) { 
    alert('请安装 Phantom 钱包扩展'); 
    return; 
  }

  try {
    await bs58Ready;
    
    // 显示连接中状态
    loginBtn.textContent = '连接中...';
    loginBtn.disabled = true;
    
    const { publicKey } = await window.solana.connect();
    WALLET = publicKey.toString();

    const { nonce } = await (await fetch(`/api/nonce?wallet=${WALLET}`)).json();
    const msg = `Sign in to WalletGen\nNonce: ${nonce}`;
    const bytes = new TextEncoder().encode(msg);
    const sig = await window.solana.signMessage(bytes);
    const sigB58 = bs58.encode(sig.signature ?? sig);

    if (bs58.decode(sigB58).length !== 64)
      throw new Error('签名长度异常');

    const body = new URLSearchParams({ 
      wallet: WALLET, 
      message: msg, 
      signature: sigB58 
    });
    
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    
    if (!r.ok) {
      const d = (await r.json()).detail || '';
      throw new Error(`登录失败: ${d}`);
    }
    
    JWT = (await r.json()).token;
    localStorage.setItem('walletJWT', JWT);
    localStorage.setItem('walletAddr', WALLET);
    
    renderLogin();
    hideAlert();
    
    // 刷新当前页面数据
    if (currentPage === 'generate') {
      loadHist();
    } else if (currentPage === 'manage') {
      loadWallets();
    }
    
  } catch (e) { 
    console.error(e); 
    alertMsg(e.message); 
  } finally {
    loginBtn.disabled = false;
    renderLogin();
  }
};

loginBtn.onmouseenter = () => { 
  if (JWT) loginBtn.textContent = '退出登录'; 
};
loginBtn.onmouseleave = renderLogin;

/* ---------- 批量生成 ---------- */
if (genForm) {
  genForm.onsubmit = async (e) => {
    e.preventDefault();
    if (!JWT) { 
      alertMsg('请先连接钱包登录'); 
      return; 
    }

    const fd = Object.fromEntries(new FormData(e.target).entries());
    
    // 验证输入
    if (+fd.min_delay > +fd.max_delay) { 
      alertMsg('最小间隔不能大于最大间隔'); 
      return; 
    }
    
    if (+fd.num > 1000) {
      alertMsg('单次生成数量不能超过 1000 个');
      return;
    }

    // 显示生成中状态
    spin.hidden = false;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="btn-icon">⏳</span> 生成中...';
    hideAlert();
    statusEl.textContent = '⏳ 正在生成钱包，请稍候...';
    resultEl.innerHTML = '';
    resultSection.style.display = 'block';

    try {
      const r = await authFetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fd)
      });
      
      if (!r.ok) {
        throw new Error(`服务器错误 (${r.status})`);
      }
      
      const d = await r.json();
      
      statusEl.innerHTML = `
        <span style="color: var(--success-color);">🎉 成功生成 ${d.count} 个钱包</span>
        <a href="#" onclick="downloadJob('${d.job_id}'); return false;" 
           style="margin-left: 16px; color: var(--accent-color); text-decoration: none; font-weight: 500;">
          📥 下载文件包
        </a>
      `;
      
      renderPubkeys(d.pubkeys);
      loadHist();
      
    } catch (e) { 
      alertMsg(e.message);
      resultSection.style.display = 'none';
    } finally { 
      spin.hidden = true; 
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span class="btn-icon">🚀</span> 开始生成';
    }
  };
}

const renderPubkeys = (arr) => {
  resultEl.innerHTML = `
    <div style="margin-bottom: 16px; font-weight: 500; color: var(--text-secondary);">
      生成的钱包地址：
    </div>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>钱包地址</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        ${arr.map((pk, i) => `
          <tr>
            <td>${i + 1}</td>
            <td style="font-family: monospace; font-size: 13px;">${pk}</td>
            <td>
              <button class="copy" data-pk="${pk}" style="font-size: 12px;">
                📋 复制
              </button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
};

// 复制功能
if (resultEl) {
  resultEl.addEventListener('click', (e) => {
    if (e.target.classList.contains('copy')) {
      const pk = e.target.dataset.pk;
      navigator.clipboard.writeText(pk).then(() => {
        const originalText = e.target.textContent;
        e.target.textContent = '✅ 已复制';
        e.target.style.background = 'var(--success-color)';
        setTimeout(() => {
          e.target.textContent = originalText;
          e.target.style.background = 'var(--accent-color)';
        }, 2000);
      }).catch(() => {
        // 如果复制失败，手动选中文本
        alert(`请手动复制: ${pk}`);
      });
    }
  });
}

/* ---------- 生成历史 ---------- */
const loadHist = async () => {
  if (!JWT) { 
    histEl.innerHTML = '<p class="muted">请先登录查看生成历史</p>'; 
    return; 
  }
  
  try {
    const r = await authFetch('/api/jobs');
    if (!r.ok) return;
    
    const jobs = await r.json();
    
    if (jobs.length === 0) {
      histEl.innerHTML = '<p class="muted">暂无生成记录</p>';
      return;
    }
    
    histEl.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>生成时间</th>
            <th>钱包数量</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${jobs.map((job, i) => `
            <tr>
              <td>${i + 1}</td>
              <td>${new Date(job.created).toLocaleString()}</td>
              <td><strong>${job.count}</strong> 个</td>
              <td>
                <a href="#" onclick="downloadJob('${job.job_id}'); return false;" 
                   style="color: var(--accent-color); text-decoration: none;">
                  📥 下载
                </a>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {
    console.error('加载历史失败:', e);
  }
};

/* ---------- 钱包管理 ---------- */
const loadWallets = async () => {
  if (!JWT) { 
    walletListEl.innerHTML = '<p class="muted">请先连接钱包登录</p>';
    walletActionsEl.style.display = 'none';
    totalBalanceBox.style.display = 'none';
    return; 
  }
  
  walletActionsEl.style.display = 'flex';
  
  try {
    const r = await authFetch('/api/wallets');
    if (!r.ok) {
      throw new Error('获取钱包列表失败');
    }
    
    const wallets = await r.json();
    
    if (wallets.length === 0) {
      walletListEl.innerHTML = '<p class="muted">暂无钱包，请生成或导入钱包</p>';
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
              <td style="font-family: monospace; font-size: 12px; max-width: 200px; overflow: hidden; text-overflow: ellipsis;">
                ${w.public_key}
              </td>
              <td>
                <span class="wallet-name" data-id="${w.id}" title="点击编辑名称">
                  ${w.name || '-'}
                </span>
              </td>
              <td>
                <span style="padding: 2px 6px; border-radius: 4px; font-size: 11px; 
                      background: ${w.source === 'generated' ? '#e3f2fd' : '#fff3e0'}; 
                      color: ${w.source === 'generated' ? '#1976d2' : '#f57c00'};">
                  ${w.source === 'generated' ? '生成' : '导入'}
                </span>
              </td>
              <td style="font-family: monospace; font-weight: 500; color: var(--success-color);">
                ${w.balance !== null ? w.balance.toFixed(4) : '-'}
              </td>
              <td style="font-size: 12px; color: var(--text-secondary);">
                ${new Date(w.created).toLocaleString()}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    
    // 绑定事件
    setupWalletTableEvents();
    
  } catch (e) {
    console.error('加载钱包失败:', e);
    alertMsg('加载钱包列表失败: ' + e.message);
  }
};

const setupWalletTableEvents = () => {
  // 全选功能
  const selectAllCheckbox = $('#selectAll');
  if (selectAllCheckbox) {
    selectAllCheckbox.onchange = (e) => {
      $$('.wallet-select').forEach(cb => cb.checked = e.target.checked);
      updateSelectedWallets();
    };
  }
  
  // 单选功能
  $$('.wallet-select').forEach(cb => {
    cb.onchange = updateSelectedWallets;
  });

  // 编辑名称
  $$('.wallet-name').forEach(span => {
    span.onclick = async () => {
      const id = span.dataset.id;
      const current = span.textContent === '-' ? '' : span.textContent;
      const name = prompt('输入新的钱包名称:', current);
      if (name === null) return;
      
      try {
        const r = await authFetch(`/api/wallets/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim() })
        });
        
        if (!r.ok) throw new Error('更新失败');
        
        span.textContent = name.trim() || '-';
        
      } catch (e) {
        alertMsg('更新钱包名称失败: ' + e.message);
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
  const hasSelection = selectedWallets.size > 0;
  $('#exportBtn').disabled = !hasSelection;
  $('#balanceBtn').disabled = !hasSelection;
  $('#deleteBtn').disabled = !hasSelection;
};

/* ---------- 弹窗管理 ---------- */
const showImportModal = () => {
  importModal.hidden = false;
  importTextarea.focus();
};

const hideImportModal = () => {
  importModal.hidden = true;
  importTextarea.value = '';
};

// 弹窗事件绑定
$('#importBtn').onclick = showImportModal;
importCancel.onclick = hideImportModal;
modalClose.onclick = hideImportModal;

// 点击背景关闭弹窗
importModal.onclick = (e) => {
  if (e.target === importModal) {
    hideImportModal();
  }
};

// ESC 键关闭弹窗
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !importModal.hidden) {
    hideImportModal();
  }
});

// 拖拽文件读取
importTextarea.addEventListener('dragover', (e) => {
  e.preventDefault();
  importTextarea.style.borderColor = 'var(--accent-color)';
  importTextarea.style.background = '#f0f8ff';
});

importTextarea.addEventListener('dragleave', (e) => {
  e.preventDefault();
  importTextarea.style.borderColor = 'var(--border-color)';
  importTextarea.style.background = '#fafafa';
});

importTextarea.addEventListener('drop', (e) => {
  e.preventDefault();
  importTextarea.style.borderColor = 'var(--border-color)';
  importTextarea.style.background = '#fafafa';
  
  const file = e.dataTransfer.files[0];
  if (!file) return;
  
  if (!file.name.endsWith('.json')) {
    alertMsg('请选择 JSON 格式的文件');
    return;
  }
  
  const reader = new FileReader();
  reader.onload = () => {
    importTextarea.value = reader.result;
  };
  reader.onerror = () => {
    alertMsg('文件读取失败');
  };
  reader.readAsText(file);
});

// 导入确认
importConfirm.onclick = async () => {
  const text = importTextarea.value.trim();
  if (!text) { 
    alertMsg('请输入私钥内容或拖拽文件'); 
    return; 
  }

  // 简单验证 JSON 格式
  try {
    JSON.parse(text);
  } catch (e) {
    alertMsg('无效的 JSON 格式');
    return;
  }

  const blob = new Blob([text], { type: 'application/json' });
  const formData = new FormData();
  formData.append('file', blob, 'import.json');

  const originalText = importConfirm.textContent;
  importConfirm.textContent = '导入中...';
  importConfirm.disabled = true;

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
    
    hideImportModal();
    
    if (result.failed > 0) {
      alert(`导入完成！\n✅ 成功: ${result.imported} 个\n❌ 失败: ${result.failed} 个\n\n请检查文件格式是否正确。`);
    } else {
      alert(`🎉 导入成功！共导入 ${result.imported} 个钱包。`);
    }
    
    loadWallets();
    
  } catch (e) {
    alertMsg('导入失败: ' + e.message);
  } finally {
    importConfirm.textContent = originalText;
    importConfirm.disabled = false;
  }
};

/* ---------- 钱包操作 ---------- */

// 导出钱包
$('#exportBtn').onclick = async () => {
  if (selectedWallets.size === 0) {
    alertMsg('请选择要导出的钱包');
    return;
  }
  
  const btn = $('#exportBtn');
  const originalText = btn.innerHTML;
  btn.innerHTML = '<span class="btn-icon">⏳</span> 导出中...';
  btn.disabled = true;
  
  try {
    const r = await authFetch('/api/wallets/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Array.from(selectedWallets))
    });
    
    if (!r.ok) throw new Error('导出失败');
    
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wallets_export_${selectedWallets.size}_${new Date().getTime()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
  } catch (e) {
    alertMsg('导出失败: ' + e.message);
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = selectedWallets.size === 0;
  }
};

// 查询余额
$('#balanceBtn').onclick = async () => {
  if (selectedWallets.size === 0) {
    alertMsg('请选择要查询余额的钱包');
    return;
  }
  
  const btn = $('#balanceBtn');
  const originalText = btn.innerHTML;
  btn.innerHTML = '<span class="btn-icon">⏳</span> 查询中...';
  btn.disabled = true;
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
      const checkbox = $(`.wallet-select[value="${id}"]`);
      if (checkbox) checkbox.checked = true;
    });
    
  } catch (e) {
    alertMsg('查询余额失败: ' + e.message);
    totalBalanceBox.classList.remove('loading');
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = selectedWallets.size === 0;
  }
};

// 删除钱包
$('#deleteBtn').onclick = async () => {
  if (selectedWallets.size === 0) {
    alertMsg('请选择要删除的钱包');
    return;
  }
  
  const confirmed = confirm(
    `⚠️ 确定要删除 ${selectedWallets.size} 个钱包吗？\n\n此操作不可恢复，请确保已备份重要钱包！`
  );
  
  if (!confirmed) return;
  
  const btn = $('#deleteBtn');
  const originalText = btn.innerHTML;
  btn.innerHTML = '<span class="btn-icon">⏳</span> 删除中...';
  btn.disabled = true;
  
  try {
    const r = await authFetch('/api/wallets', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Array.from(selectedWallets))
    });
    
    if (!r.ok) throw new Error('删除失败');
    
    const result = await r.json();
    alert(`🗑️ 成功删除 ${result.deleted} 个钱包`);
    
    // 清空选择并重新加载
    selectedWallets.clear();
    totalBalanceBox.style.display = 'none';
    loadWallets();
    
  } catch (e) {
    alertMsg('删除失败: ' + e.message);
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = true; // 删除后禁用，等待重新选择
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
    a.download = `wallet_job_${jobId}_${new Date().getTime()}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {
    alertMsg('下载失败: ' + e.message);
  }
};

/* ---------- 初始化 ---------- */
document.addEventListener('DOMContentLoaded', () => {
  // 渲染登录状态
  renderLogin();
  
  // 显示默认页面
  showPage('generate');
  
  // 如果已登录，加载对应数据
  if (JWT) {
    loadHist();
  }
  
  // 添加一些用户体验优化
  document.addEventListener('click', (e) => {
    // 如果点击的是链接但没有有效的onclick，阻止默认行为
    if (e.target.tagName === 'A' && e.target.getAttribute('href') === '#') {
      e.preventDefault();
    }
  });
  
  console.log('🚀 Solana 工具站初始化完成');
});
