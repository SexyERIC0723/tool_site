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
  transfer: $('#transferPage'),
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

// 转账页面元素
const tabBtns = $$('.tab-btn');
const transferContents = $$('.transfer-content');
const singleTransferForm = $('#singleTransferForm');
const batchTransferForm = $('#batchTransferForm');
const fromWalletSelector = $('#fromWalletSelector');
const fromWalletDisplay = $('#fromWalletDisplay');
const fromWalletDropdown = $('#fromWalletDropdown');
const selectedFromAddress = $('#selectedFromAddress');
const toAddressInput = $('#toAddressInput');
const batchToAddressInput = $('#batchToAddressInput');
const feeDisplay = $('#feeDisplay');
const transferPreview = $('#transferPreview');
const batchTransferPreview = $('#batchTransferPreview');
const batchWalletGrid = $('#batchWalletGrid'); // 使用网格布局

// 新增元素
const internalTransferBtn = $('#internalTransferBtn');
const batchInternalTransferBtn = $('#batchInternalTransferBtn');
const internalWalletModal = $('#internalWalletModal');
const internalWalletList = $('#internalWalletList');
const modeBtns = $$('.mode-btn');
const recipientConfigs = $$('.recipient-config');
const addRecipientBtn = $('#addRecipientBtn');
const recipientList = $('#recipientList');
const internalWalletGrid = $('#internalWalletGrid');

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
let selectedBatchWallets = new Set();
let selectedInternalWallets = new Set();
let currentPage = 'generate';
let currentTransferTab = 'single';
let currentRecipientMode = 'single';
let userWallets = [];
let transferFee = 0;
let currentInternalTransferTarget = null; // 'single' 或 'batch'
let fromWalletSelectorInstance = null; // 钱包选择器实例

/* ---------- 页面切换 ---------- */
const showPage = (pageName) => {
  // 隐藏所有页面
  Object.values(pages).forEach(page => {
    if (page) page.classList.remove('active');
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
    } else if (pageName === 'transfer' && JWT) {
      initTransferPage();
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

/* ---------- 转账标签切换 ---------- */
const showTransferTab = (tabName) => {
  // 更新标签状态
  tabBtns.forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.tab === tabName) {
      btn.classList.add('active');
    }
  });
  
  // 更新内容显示
  transferContents.forEach(content => {
    content.classList.remove('active');
    if (content.id === `${tabName}Transfer`) {
      content.classList.add('active');
    }
  });
  
  currentTransferTab = tabName;
};

// 标签点击事件
tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    showTransferTab(btn.dataset.tab);
  });
});

/* ---------- 通用工具 ---------- */
const renderLogin = () => {
  if (loginBtn) {
    loginBtn.textContent = JWT
      ? `已登录: ${WALLET.slice(0, 4)}…${WALLET.slice(-4)}`
      : '连接钱包 / 登录';
    loginBtn.classList.toggle('connected', !!JWT);
  }
};

const alertMsg = (m) => { 
  if (alertEl) {
    alertEl.textContent = m; 
    alertEl.style.display = 'block'; 
    // 5秒后自动隐藏
    setTimeout(hideAlert, 5000);
  }
};

const hideAlert = () => { 
  if (alertEl) {
    alertEl.style.display = 'none'; 
  }
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
  } else if (currentPage === 'transfer') {
    initTransferPage();
  }
};

const authFetch = async (url, opt = {}) => {
  if (JWT) (opt.headers ??= {}).Authorization = 'Bearer ' + JWT;
  const r = await fetch(url, opt);
  if (r.status === 401) logout();
  return r;
};

/* ---------- 登录/登出 ---------- */
if (loginBtn) {
  loginBtn.onclick = async () => {
    console.log('🔗 连接钱包按钮被点击');
    
    if (JWT) { 
      console.log('🚪 用户已登录，执行登出');
      logout(); 
      return; 
    }
    
    if (!window.solana?.isPhantom) { 
      console.error('❌ Phantom钱包未安装');
      alert('请安装 Phantom 钱包扩展'); 
      return; 
    }

    try {
      console.log('⏳ 等待bs58库加载...');
      await bs58Ready;
      console.log('✅ bs58库已加载');
      
      // 显示连接中状态
      loginBtn.textContent = '连接中...';
      loginBtn.disabled = true;
      
      console.log('🔌 尝试连接Phantom钱包...');
      const { publicKey } = await window.solana.connect();
      WALLET = publicKey.toString();
      console.log('✅ 钱包连接成功:', WALLET);

      console.log('🔢 获取nonce...');
      const { nonce } = await (await fetch(`/api/nonce?wallet=${WALLET}`)).json();
      console.log('✅ nonce获取成功:', nonce);
      
      const msg = `Sign in to WalletGen\nNonce: ${nonce}`;
      const bytes = new TextEncoder().encode(msg);
      
      console.log('✍️ 请求用户签名...');
      const sig = await window.solana.signMessage(bytes);
      const sigB58 = bs58.encode(sig.signature ?? sig);
      console.log('✅ 用户签名成功');

      if (bs58.decode(sigB58).length !== 64) {
        throw new Error('签名长度异常');
      }

      const body = new URLSearchParams({ 
        wallet: WALLET, 
        message: msg, 
        signature: sigB58 
      });
      
      console.log('🌐 发送登录请求...');
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
      
      console.log('🎉 登录成功!');
      renderLogin();
      hideAlert();
      
      // 刷新当前页面数据
      if (currentPage === 'generate') {
        loadHist();
      } else if (currentPage === 'manage') {
        loadWallets();
      } else if (currentPage === 'transfer') {
        initTransferPage();
      }
      
    } catch (e) { 
      console.error('❌ 登录失败:', e); 
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
}

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
    if (spin) spin.hidden = false;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="btn-icon">⏳</span> 生成中...';
    }
    hideAlert();
    if (statusEl) statusEl.textContent = '⏳ 正在生成钱包，请稍候...';
    if (resultEl) resultEl.innerHTML = '';
    if (resultSection) resultSection.style.display = 'block';

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
      
      if (statusEl) {
        statusEl.innerHTML = `
          <span style="color: var(--success-color);">🎉 成功生成 ${d.count} 个钱包</span>
          <a href="#" onclick="downloadJob('${d.job_id}'); return false;" 
             style="margin-left: 16px; color: var(--accent-color); text-decoration: none; font-weight: 500;">
            📥 下载文件包
          </a>
        `;
      }
      
      renderPubkeys(d.pubkeys);
      loadHist();
      
    } catch (e) { 
      alertMsg(e.message);
      if (resultSection) resultSection.style.display = 'none';
    } finally { 
      if (spin) spin.hidden = true; 
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span class="btn-icon">🚀</span> 开始生成';
      }
    }
  };
}

const renderPubkeys = (arr) => {
  if (!resultEl) return;
  
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
        alert(`请手动复制: ${pk}`);
      });
    }
  });
}

/* ---------- 生成历史 ---------- */
const loadHist = async () => {
  if (!histEl) return;
  
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
  if (!walletListEl) return;
  
  if (!JWT) { 
    walletListEl.innerHTML = '<p class="muted">请先连接钱包登录</p>';
    if (walletActionsEl) walletActionsEl.style.display = 'none';
    if (totalBalanceBox) totalBalanceBox.style.display = 'none';
    return; 
  }
  
  if (walletActionsEl) walletActionsEl.style.display = 'flex';
  
  try {
    const r = await authFetch('/api/wallets');
    if (!r.ok) {
      throw new Error('获取钱包列表失败');
    }
    
    const wallets = await r.json();
    userWallets = wallets; // 保存到全局变量
    
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
  const exportBtn = $('#exportBtn');
  const balanceBtn = $('#balanceBtn');
  const deleteBtn = $('#deleteBtn');
  
  if (exportBtn) exportBtn.disabled = !selectedWallets.size;
  if (balanceBtn) balanceBtn.disabled = !selectedWallets.size;
  if (deleteBtn) deleteBtn.disabled = !selectedWallets.size;
};

/* ---------- 转账模式管理 ---------- */
const setupTransferModes = () => {
  // 接收方模式切换
  modeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      switchRecipientMode(mode);
    });
  });
  
  // 添加接收方按钮
  if (addRecipientBtn) {
    addRecipientBtn.addEventListener('click', addRecipient);
  }
  
  // 初始化一个接收方项
  updateRecipientRemoveButtons();
};

const switchRecipientMode = (mode) => {
  currentRecipientMode = mode;
  
  // 更新按钮状态
  modeBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  
  // 更新配置区域显示
  recipientConfigs.forEach(config => {
    const configMode = config.className.includes('single-mode') ? 'single' :
                      config.className.includes('multiple-mode') ? 'multiple' : 'internal';
    config.classList.toggle('active', configMode === mode);
  });
  
  // 更新表单容器类名
  const batchTransfer = $('#batchTransfer');
  if (batchTransfer) {
    batchTransfer.className = `transfer-content ${mode}-mode`;
    if (currentTransferTab === 'batch') {
      batchTransfer.classList.add('active');
    }
  }
  
  // 根据模式初始化内容
  if (mode === 'internal') {
    loadInternalWalletGrid();
  } else if (mode === 'multiple') {
    // 确保至少有一个接收方
    if (recipientList && recipientList.children.length === 0) {
      addRecipient();
    }
  }
};

const addRecipient = () => {
  if (!recipientList) return;
  
  const index = recipientList.children.length + 1;
  const recipientItem = document.createElement('div');
  recipientItem.className = 'recipient-item';
  recipientItem.innerHTML = `
    <input type="text" placeholder="接收方地址 #${index}" class="recipient-address" required />
    <input type="number" placeholder="金额 (SOL)" class="recipient-amount" step="0.000001" min="0.000001" required />
    <button type="button" class="remove-recipient">✕</button>
  `;
  
  // 绑定删除按钮事件
  recipientItem.querySelector('.remove-recipient').addEventListener('click', () => {
    recipientItem.remove();
    updateRecipientRemoveButtons();
    updateRecipientNumbers();
  });
  
  recipientList.appendChild(recipientItem);
  updateRecipientRemoveButtons();
};

const updateRecipientRemoveButtons = () => {
  if (!recipientList) return;
  
  const items = recipientList.querySelectorAll('.recipient-item');
  items.forEach((item, index) => {
    const removeBtn = item.querySelector('.remove-recipient');
    // 第一个项目不显示删除按钮，或者只有一个项目时不显示
    if (removeBtn) {
      removeBtn.style.display = items.length > 1 ? 'block' : 'none';
    }
  });
};

const updateRecipientNumbers = () => {
  if (!recipientList) return;
  
  const items = recipientList.querySelectorAll('.recipient-item');
  items.forEach((item, index) => {
    const addressInput = item.querySelector('.recipient-address');
    if (addressInput) {
      addressInput.placeholder = `接收方地址 #${index + 1}`;
    }
  });
};

/* ---------- 内部转账管理 ---------- */
const setupInternalTransfer = () => {
  // 单笔转账内部转账按钮
  if (internalTransferBtn) {
    internalTransferBtn.addEventListener('click', () => {
      currentInternalTransferTarget = 'single';
      showInternalWalletModal();
    });
  }
  
  // 批量转账内部转账按钮
  if (batchInternalTransferBtn) {
    batchInternalTransferBtn.addEventListener('click', () => {
      currentInternalTransferTarget = 'batch';
      showInternalWalletModal();
    });
  }
  
  // 弹窗事件
  const internalModalClose = $('#internalWalletModalClose');
  const cancelInternalWallet = $('#cancelInternalWallet');
  const confirmInternalWallet = $('#confirmInternalWallet');
  
  if (internalModalClose) {
    internalModalClose.addEventListener('click', hideInternalWalletModal);
  }
  
  if (cancelInternalWallet) {
    cancelInternalWallet.addEventListener('click', hideInternalWalletModal);
  }
  
  if (confirmInternalWallet) {
    confirmInternalWallet.addEventListener('click', confirmInternalWalletSelection);
  }
  
  // 点击背景关闭弹窗
  if (internalWalletModal) {
    internalWalletModal.addEventListener('click', (e) => {
      if (e.target === internalWalletModal) {
        hideInternalWalletModal();
      }
    });
  }
};

const showInternalWalletModal = () => {
  if (!userWallets.length) {
    alertMsg('暂无钱包可供选择，请先生成或导入钱包');
    return;
  }
  
  renderInternalWalletList();
  if (internalWalletModal) {
    internalWalletModal.hidden = false;
  }
};

const hideInternalWalletModal = () => {
  if (internalWalletModal) {
    internalWalletModal.hidden = true;
  }
  // 清空选择
  if (internalWalletList) {
    internalWalletList.querySelectorAll('.internal-wallet-item').forEach(item => {
      item.classList.remove('selected');
      const radio = item.querySelector('input[type="radio"]');
      if (radio) radio.checked = false;
    });
  }
  const confirmBtn = $('#confirmInternalWallet');
  if (confirmBtn) confirmBtn.disabled = true;
};

const renderInternalWalletList = () => {
  if (!internalWalletList) return;
  
  internalWalletList.innerHTML = userWallets.map(wallet => `
    <div class="internal-wallet-item" data-address="${wallet.public_key}">
      <input type="radio" name="internalWallet" value="${wallet.public_key}" />
      <div class="wallet-avatar">
        ${wallet.name ? wallet.name.charAt(0).toUpperCase() : '#'}
      </div>
      <div class="wallet-details">
        <div class="wallet-name">${wallet.name || `钱包 #${wallet.id}`}</div>
        <div class="wallet-address-short">${wallet.public_key.slice(0, 8)}...${wallet.public_key.slice(-4)}</div>
      </div>
      <div class="wallet-balance">${wallet.balance ? wallet.balance.toFixed(4) : '0.0000'} SOL</div>
    </div>
  `).join('');
  
  // 绑定选择事件
  internalWalletList.querySelectorAll('.internal-wallet-item').forEach(item => {
    item.addEventListener('click', () => {
      // 取消其他选择
      internalWalletList.querySelectorAll('.internal-wallet-item').forEach(i => {
        i.classList.remove('selected');
        const radio = i.querySelector('input[type="radio"]');
        if (radio) radio.checked = false;
      });
      
      // 选中当前项
      item.classList.add('selected');
      const radio = item.querySelector('input[type="radio"]');
      if (radio) radio.checked = true;
      
      // 启用确认按钮
      const confirmBtn = $('#confirmInternalWallet');
      if (confirmBtn) confirmBtn.disabled = false;
    });
  });
};

const confirmInternalWalletSelection = () => {
  if (!internalWalletList) return;
  
  const selectedRadio = internalWalletList.querySelector('input[type="radio"]:checked');
  if (!selectedRadio) return;
  
  const selectedAddress = selectedRadio.value;
  const selectedWallet = userWallets.find(w => w.public_key === selectedAddress);
  
  if (currentInternalTransferTarget === 'single') {
    // 设置单笔转账的接收方
    if (toAddressInput) {
      toAddressInput.value = selectedAddress;
      // 触发地址验证
      validateAddress(toAddressInput, $('#addressValidation'));
    }
  } else if (currentInternalTransferTarget === 'batch') {
    // 设置批量转账的接收方
    if (batchToAddressInput) {
      batchToAddressInput.value = selectedAddress;
      // 触发地址验证
      validateAddress(batchToAddressInput, $('#batchAddressValidation'));
    }
  }
  
  hideInternalWalletModal();
  alertMsg(`已选择内部钱包: ${selectedWallet.name || '未命名'} (${selectedAddress.slice(0, 8)}...${selectedAddress.slice(-4)})`);
};

const loadInternalWalletGrid = () => {
  if (!internalWalletGrid) return;
  
  if (!userWallets.length) {
    internalWalletGrid.innerHTML = '<p class="muted">暂无钱包可供选择</p>';
    return;
  }
  
  // 优化后的HTML结构，更美观的布局
  internalWalletGrid.innerHTML = userWallets.map(wallet => {
    // 生成渐变色头像背景
    const colors = [
      'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
      'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
      'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
      'linear-gradient(135deg, #fa709a 0%, #fee140 100%)'
    ];
    const colorIndex = wallet.id % colors.length;
    
    return `
      <div class="internal-wallet-item" data-address="${wallet.public_key}">
        <input type="checkbox" class="internal-wallet-select" value="${wallet.public_key}" />
        <div class="wallet-avatar" style="background: ${colors[colorIndex]};">
          ${wallet.name ? wallet.name.charAt(0).toUpperCase() : wallet.id}
        </div>
        <div class="wallet-info">
          <div class="wallet-name">${wallet.name || `钱包 #${wallet.id}`}</div>
          <div class="wallet-address">
            <span class="address-text" title="${wallet.public_key}">${wallet.public_key}</span>
            <button class="copy-btn" onclick="copyAddress('${wallet.public_key}', this)" title="复制地址">📋</button>
          </div>
        </div>
        <div class="wallet-balance">
          <span class="balance-label">余额</span>
          ${wallet.balance ? wallet.balance.toFixed(4) : '0.0000'} SOL
        </div>
      </div>
    `;
  }).join('');
  
  // 绑定选择事件
  internalWalletGrid.querySelectorAll('.internal-wallet-item').forEach(item => {
    const checkbox = item.querySelector('.internal-wallet-select');
    const address = item.dataset.address;
    
    // 点击整个项目切换选择状态
    item.addEventListener('click', (e) => {
      // 如果点击的是复选框或复制按钮，让其正常处理
      if (e.target === checkbox || e.target.classList.contains('copy-btn')) return;
      
      // 切换复选框状态
      checkbox.checked = !checkbox.checked;
      
      // 触发选择状态更新
      updateInternalWalletSelection(address, checkbox.checked);
    });
    
    // 复选框变化事件
    checkbox.addEventListener('change', (e) => {
      updateInternalWalletSelection(address, e.target.checked);
    });
    
    // 恢复之前的选择状态
    if (selectedInternalWallets.has(address)) {
      checkbox.checked = true;
      item.classList.add('selected');
    }
  });
  
  // 更新选择信息
  updateInternalSelectionInfo();
};

// 添加更新选择信息的函数
const updateInternalSelectionInfo = () => {
  // 检查是否已存在选择信息栏
  let selectionInfo = document.querySelector('.internal-wallet-selection-info');
  const container = document.querySelector('.recipient-config.internal-mode');
  
  if (!container) return;
  
  if (selectedInternalWallets.size > 0) {
    if (!selectionInfo) {
      selectionInfo = document.createElement('div');
      selectionInfo.className = 'internal-wallet-selection-info';
      container.insertBefore(selectionInfo, internalWalletGrid);
    }
    
    selectionInfo.innerHTML = `
      <div class="selection-count">
        已选择 <strong>${selectedInternalWallets.size}</strong> 个钱包作为接收方
      </div>
      <div class="selection-actions">
        <button class="selection-btn" onclick="selectAllInternalWallets()">全选</button>
        <button class="selection-btn" onclick="clearInternalWalletSelection()">清除</button>
      </div>
    `;
  } else if (selectionInfo) {
    selectionInfo.remove();
  }
};

// 添加全选功能
window.selectAllInternalWallets = () => {
  if (!internalWalletGrid) return;
  
  internalWalletGrid.querySelectorAll('.internal-wallet-item').forEach(item => {
    const checkbox = item.querySelector('.internal-wallet-select');
    const address = item.dataset.address;
    
    if (!checkbox.checked) {
      checkbox.checked = true;
      updateInternalWalletSelection(address, true);
    }
  });
};

// 添加清除选择功能
window.clearInternalWalletSelection = () => {
  if (!internalWalletGrid) return;
  
  internalWalletGrid.querySelectorAll('.internal-wallet-item').forEach(item => {
    const checkbox = item.querySelector('.internal-wallet-select');
    const address = item.dataset.address;
    
    if (checkbox.checked) {
      checkbox.checked = false;
      updateInternalWalletSelection(address, false);
    }
  });
};

// 添加复制地址功能
window.copyAddress = (address, btn) => {
  navigator.clipboard.writeText(address).then(() => {
    const originalText = btn.textContent;
    btn.textContent = '✅';
    setTimeout(() => {
      btn.textContent = originalText;
    }, 2000);
  }).catch(() => {
    alert(`请手动复制: ${address}`);
  });
};

// 更新选择状态函数
const updateInternalWalletSelection = (address, isSelected) => {
  const item = internalWalletGrid.querySelector(`[data-address="${address}"]`);
  
  if (isSelected) {
    selectedInternalWallets.add(address);
    if (item) item.classList.add('selected');
  } else {
    selectedInternalWallets.delete(address);
    if (item) item.classList.remove('selected');
  }
  
  // 更新选择信息
  updateInternalSelectionInfo();
};

/* ---------- 自定义钱包选择器 ---------- */
class CustomWalletSelector {
  constructor(selectorEl, displayEl, dropdownEl, hiddenInputEl) {
    this.selector = selectorEl;
    this.display = displayEl;
    this.dropdown = dropdownEl;
    this.hiddenInput = hiddenInputEl;
    this.selectedWallet = null;
    this.wallets = [];
    
    this.init();
  }
  
  init() {
    if (!this.selector || !this.display || !this.dropdown || !this.hiddenInput) {
      console.warn('钱包选择器元素缺失');
      return;
    }
    
    // 点击显示区域切换下拉菜单
    this.display.addEventListener('click', () => {
      this.toggle();
    });
    
    // 点击外部关闭下拉菜单
    document.addEventListener('click', (e) => {
      if (!this.selector.contains(e.target)) {
        this.close();
      }
    });
  }
  
  setWallets(wallets) {
    this.wallets = wallets;
    this.renderOptions();
  }
  
  renderOptions() {
    if (!this.dropdown) return;
    
    this.dropdown.innerHTML = this.wallets.map(wallet => `
      <div class="wallet-option" data-address="${wallet.public_key}">
        <div class="wallet-avatar">
          ${wallet.name ? wallet.name.charAt(0).toUpperCase() : '#'}
        </div>
        <div class="wallet-details">
          <div class="wallet-name">${wallet.name || `钱包 #${wallet.id}`}</div>
          <div class="wallet-address-short">${wallet.public_key.slice(0, 8)}...${wallet.public_key.slice(-4)}</div>
        </div>
        <div class="wallet-balance">${wallet.balance ? wallet.balance.toFixed(4) : '0.0000'} SOL</div>
      </div>
    `).join('');
    
    // 绑定选项点击事件
    this.dropdown.querySelectorAll('.wallet-option').forEach(option => {
      option.addEventListener('click', () => {
        const address = option.dataset.address;
        const wallet = this.wallets.find(w => w.public_key === address);
        this.selectWallet(wallet);
        this.close();
      });
    });
  }
  
  selectWallet(wallet) {
    this.selectedWallet = wallet;
    this.hiddenInput.value = wallet.public_key;
    
    // 更新显示
    this.display.innerHTML = `
      <div class="selected-wallet">
        <div class="wallet-avatar">
          ${wallet.name ? wallet.name.charAt(0).toUpperCase() : '#'}
        </div>
        <div class="wallet-details">
          <div class="wallet-name">${wallet.name || `钱包 #${wallet.id}`}</div>
          <div class="wallet-address-short">${wallet.public_key.slice(0, 8)}...${wallet.public_key.slice(-4)}</div>
        </div>
        <div class="wallet-balance">${wallet.balance ? wallet.balance.toFixed(4) : '0.0000'} SOL</div>
      </div>
      <span class="dropdown-arrow">▼</span>
    `;
    
    // 更新选项选中状态
    this.dropdown.querySelectorAll('.wallet-option').forEach(option => {
      option.classList.toggle('selected', option.dataset.address === wallet.public_key);
    });
  }
  
  toggle() {
    if (this.dropdown.classList.contains('show')) {
      this.close();
    } else {
      this.open();
    }
  }
  
  open() {
    this.dropdown.classList.add('show');
    this.display.classList.add('active');
  }
  
  close() {
    this.dropdown.classList.remove('show');
    this.display.classList.remove('active');
  }
  
  getSelectedWallet() {
    return this.selectedWallet;
  }
  
  reset() {
    this.selectedWallet = null;
    this.hiddenInput.value = '';
    this.display.innerHTML = `
      <span class="placeholder">请选择钱包...</span>
      <span class="dropdown-arrow">▼</span>
    `;
    this.dropdown.querySelectorAll('.wallet-option').forEach(option => {
      option.classList.remove('selected');
    });
  }
}

// 初始化转账页面
const initTransferPage = async () => {
  if (!JWT) {
    if (fromWalletSelectorInstance) {
      fromWalletSelectorInstance.reset();
    }
    const transferRecordsEl = $('#transferRecords');
    if (transferRecordsEl) {
      transferRecordsEl.innerHTML = '<p class="muted">请先登录查看转账记录</p>';
    }
    return;
  }
  
  // 加载手续费
  await loadTransferFee();
  
  // 加载用户钱包到下拉菜单
  await loadUserWalletsForTransfer();
  
  // 加载批量转账钱包列表 - 使用网格格式
  loadBatchWalletGrid();
  
  // 加载转账记录
  await loadTransferRecords();
  
  // 初始化转账功能
  setupTransferModes();
  setupInternalTransfer();
  
  // 初始化钱包选择器
  initWalletSelector();
};

// 初始化钱包选择器
const initWalletSelector = () => {
  // 初始化自定义钱包选择器
  if (fromWalletSelector && fromWalletDisplay && fromWalletDropdown && selectedFromAddress) {
    fromWalletSelectorInstance = new CustomWalletSelector(
      fromWalletSelector,
      fromWalletDisplay,
      fromWalletDropdown,
      selectedFromAddress
    );
    
    // 如果有钱包数据，设置到选择器
    if (userWallets.length > 0) {
      fromWalletSelectorInstance.setWallets(userWallets);
    }
  }
};

// 加载转账手续费
const loadTransferFee = async () => {
  try {
    const r = await authFetch('/api/transfer/fee');
    if (r.ok) {
      const { fee } = await r.json();
      transferFee = fee;
      if (feeDisplay) {
        feeDisplay.value = `${fee.toFixed(6)} SOL`;
      }
    }
  } catch (e) {
    console.error('加载手续费失败:', e);
    if (feeDisplay) {
      feeDisplay.value = '0.000005 SOL (估算)';
    }
  }
};

// 加载用户钱包列表
const loadUserWalletsForTransfer = async () => {
  try {
    const r = await authFetch('/api/wallets');
    if (r.ok) {
      const wallets = await r.json();
      userWallets = wallets;
      
      // 更新自定义钱包选择器
      if (fromWalletSelectorInstance) {
        fromWalletSelectorInstance.setWallets(wallets);
      }
    }
  } catch (e) {
    console.error('加载钱包失败:', e);
  }
};

// 修复后的批量转账钱包网格加载函数 - 关键修复
const loadBatchWalletGrid = () => {
  console.log('🔄 开始加载批量转账钱包网格...');
  
  if (!batchWalletGrid) {
    console.error('❌ batchWalletGrid 元素未找到');
    return;
  }
  
  if (!userWallets.length) {
    console.log('⚠️ 无钱包数据，显示提示信息');
    batchWalletGrid.innerHTML = '<p class="muted">暂无钱包</p>';
    return;
  }
  
  console.log('✅ 开始渲染钱包网格...');
  
  try {
    // 使用与内部钱包网格相同的格式，关键修复：添加 data-wallet-id 属性
    batchWalletGrid.innerHTML = userWallets.map(wallet => {
      // 生成渐变色头像背景
      const colors = [
        'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
        'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
        'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
        'linear-gradient(135deg, #fa709a 0%, #fee140 100%)'
      ];
      const colorIndex = wallet.id % colors.length;
      
      return `
        <div class="batch-wallet-item" data-address="${wallet.public_key}" data-wallet-id="${wallet.id}">
          <input type="checkbox" class="batch-wallet-select" value="${wallet.id}" data-address="${wallet.public_key}" />
          <div class="wallet-avatar" style="background: ${colors[colorIndex]};">
            ${wallet.name ? wallet.name.charAt(0).toUpperCase() : wallet.id}
          </div>
          <div class="wallet-info">
            <div class="wallet-name">${wallet.name || `钱包 #${wallet.id}`}</div>
            <div class="wallet-address">
              <span class="address-text" title="${wallet.public_key}">${wallet.public_key}</span>
              <button class="copy-btn" onclick="copyAddress('${wallet.public_key}', this)" title="复制地址">📋</button>
            </div>
          </div>
          <div class="wallet-balance">
            <span class="balance-label">余额</span>
            ${wallet.balance ? wallet.balance.toFixed(4) : '0.0000'} SOL
          </div>
        </div>
      `;
    }).join('');
    
    console.log('HTML已设置到DOM');
    
    // 分离事件绑定到独立函数 - 关键修复
    bindBatchWalletEvents();
    
    console.log('🎉 批量转账钱包网格加载完成！');
    
  } catch (error) {
    console.error('Error in loadBatchWalletGrid:', error);
  }
};

// 分离的事件绑定函数 - 关键修复
const bindBatchWalletEvents = () => {
  console.log('=== 绑定批量钱包事件 ===');
  
  const items = batchWalletGrid.querySelectorAll('.batch-wallet-item');
  console.log('找到的钱包项数量:', items.length);
  
  items.forEach((item, index) => {
    const checkbox = item.querySelector('.batch-wallet-select');
    const walletId = parseInt(checkbox.value);
    
    // 点击整个项目切换选择状态
    item.addEventListener('click', (e) => {
      if (e.target === checkbox || e.target.classList.contains('copy-btn')) return;
      
      checkbox.checked = !checkbox.checked;
      updateBatchWalletSelection(walletId, checkbox.checked);
    });
    
    // 复选框变化事件
    checkbox.addEventListener('change', (e) => {
      updateBatchWalletSelection(walletId, e.target.checked);
    });
    
    // 恢复之前的选择状态
    if (selectedBatchWallets.has(walletId)) {
      checkbox.checked = true;
      item.classList.add('selected');
    }
  });
  
  // 更新选择信息
  updateBatchSelectionInfo();
  console.log('事件绑定完成');
};

// 修复后的更新批量钱包选择状态函数 - 关键修复
const updateBatchWalletSelection = (walletId, isSelected) => {
  // 使用 data-wallet-id 属性查找元素，而不是通过 checkbox - 关键修复
  const targetItem = batchWalletGrid.querySelector(`[data-wallet-id="${walletId}"]`);
  
  if (isSelected) {
    selectedBatchWallets.add(walletId);
    if (targetItem) targetItem.classList.add('selected');
  } else {
    selectedBatchWallets.delete(walletId);
    if (targetItem) targetItem.classList.remove('selected');
  }
  
  // 更新选择信息
  updateBatchSelectionInfo();
};

// 更新批量选择信息
const updateBatchSelectionInfo = () => {
  // 检查是否已存在选择信息栏
  let selectionInfo = document.querySelector('.batch-wallet-selection-info');
  const container = document.querySelector('.wallet-selection');
  
  if (!container) return;
  
  if (selectedBatchWallets.size > 0) {
    if (!selectionInfo) {
      selectionInfo = document.createElement('div');
      selectionInfo.className = 'batch-wallet-selection-info';
      container.insertBefore(selectionInfo, batchWalletGrid);
    }
    
    selectionInfo.innerHTML = `
      <div class="selection-count">
        已选择 <strong>${selectedBatchWallets.size}</strong> 个钱包进行转账
      </div>
      <div class="selection-actions">
        <button class="selection-btn" onclick="selectAllBatchWallets()">全选</button>
        <button class="selection-btn" onclick="clearBatchWalletSelection()">清除</button>
      </div>
    `;
  } else if (selectionInfo) {
    selectionInfo.remove();
  }
};

// 全选批量钱包
window.selectAllBatchWallets = () => {
  if (!batchWalletGrid) return;
  
  batchWalletGrid.querySelectorAll('.batch-wallet-item').forEach(item => {
    const checkbox = item.querySelector('.batch-wallet-select');
    const walletId = parseInt(checkbox.value);
    
    if (!checkbox.checked) {
      checkbox.checked = true;
      updateBatchWalletSelection(walletId, true);
    }
  });
};

// 清除批量钱包选择
window.clearBatchWalletSelection = () => {
  if (!batchWalletGrid) return;
  
  batchWalletGrid.querySelectorAll('.batch-wallet-item').forEach(item => {
    const checkbox = item.querySelector('.batch-wallet-select');
    const walletId = parseInt(checkbox.value);
    
    if (checkbox.checked) {
      checkbox.checked = false;
      updateBatchWalletSelection(walletId, false);
    }
  });
};

// 保留原来的函数，用于兼容性 - 修复后版本
const updateSelectedBatchWallets = () => {
  selectedBatchWallets.clear();
  $$('.batch-wallet-select:checked').forEach(cb => {
    selectedBatchWallets.add(parseInt(cb.value));
  });
  updateBatchSelectionInfo();
};

// 地址验证
const validateAddress = async (input, validationEl) => {
  if (!input || !validationEl) return false;
  
  const address = input.value.trim();
  
  if (!address) {
    validationEl.style.display = 'none';
    return false;
  }
  
  validationEl.style.display = 'block';
  validationEl.className = 'validation-info loading';
  validationEl.textContent = '🔍 验证地址中...';
  
  try {
    const r = await authFetch('/api/transfer/validate-address', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address })
    });
    
    if (r.ok) {
      const result = await r.json();
      if (result.valid) {
        validationEl.className = 'validation-info valid';
        validationEl.textContent = `✅ 地址有效${result.balance !== null ? ` (余额: ${result.balance.toFixed(6)} SOL)` : ''}`;
        return true;
      } else {
        validationEl.className = 'validation-info invalid';
        validationEl.textContent = '❌ 无效的Solana地址';
        return false;
      }
    }
  } catch (e) {
    validationEl.className = 'validation-info invalid';
    validationEl.textContent = '❌ 验证失败，请检查网络连接';
  }
  
  return false;
};

// 地址输入验证
if (toAddressInput) {
  let addressTimeout;
  toAddressInput.oninput = () => {
    clearTimeout(addressTimeout);
    addressTimeout = setTimeout(() => {
      validateAddress(toAddressInput, $('#addressValidation'));
    }, 500);
  };
}

if (batchToAddressInput) {
  let batchAddressTimeout;
  batchToAddressInput.oninput = () => {
    clearTimeout(batchAddressTimeout);
    batchAddressTimeout = setTimeout(() => {
      validateAddress(batchToAddressInput, $('#batchAddressValidation'));
    }, 500);
  };
}

// 单笔转账预览
const previewTransferBtn = $('#previewTransferBtn');
if (previewTransferBtn) {
  previewTransferBtn.addEventListener('click', async () => {
    const fromAddress = selectedFromAddress.value;
    const toAddress = toAddressInput.value;
    const amount = singleTransferForm.querySelector('input[name="amount"]').value;
    const memo = singleTransferForm.querySelector('input[name="memo"]').value;
    
    if (!fromAddress || !toAddress || !amount) {
      alertMsg('请填写完整的转账信息');
      return;
    }
    
    const originalText = previewTransferBtn.innerHTML;
    previewTransferBtn.innerHTML = '<span class="btn-icon">⏳</span> 预览中...';
    previewTransferBtn.disabled = true;
    
    try {
      const r = await authFetch('/api/transfer/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_address: fromAddress,
          to_address: toAddress,
          amount: parseFloat(amount),
          memo: memo
        })
      });
      
      if (!r.ok) {
        const error = await r.json();
        throw new Error(error.detail || '预览失败');
      }
      
      const result = await r.json();
      
      // 显示预览信息
      const previewFrom = $('#previewFrom');
      const previewTo = $('#previewTo');
      const previewAmount = $('#previewAmount');
      const previewFee = $('#previewFee');
      const previewTotal = $('#previewTotal');
      const previewRemaining = $('#previewRemaining');
      
      if (previewFrom) previewFrom.textContent = `${result.wallet_name || '未命名'} (${result.from_address.slice(0, 8)}...${result.from_address.slice(-4)})`;
      if (previewTo) previewTo.textContent = `${result.to_address.slice(0, 8)}...${result.to_address.slice(-4)}`;
      if (previewAmount) previewAmount.textContent = `${result.amount.toFixed(6)} SOL`;
      if (previewFee) previewFee.textContent = `${result.fee.toFixed(6)} SOL`;
      if (previewTotal) previewTotal.textContent = `${result.total_required.toFixed(6)} SOL`;
      if (previewRemaining) previewRemaining.textContent = `${result.remaining_balance.toFixed(6)} SOL`;
      
      if (transferPreview) transferPreview.style.display = 'block';
      const executeBtn = $('#executeTransferBtn');
      if (executeBtn) executeBtn.style.display = 'inline-flex';
      
    } catch (e) {
      alertMsg(e.message);
    } finally {
      previewTransferBtn.innerHTML = originalText;
      previewTransferBtn.disabled = false;
    }
  });
}

// 批量转账预览
const previewBatchTransferBtn = $('#previewBatchTransferBtn');
if (previewBatchTransferBtn) {
  previewBatchTransferBtn.addEventListener('click', async () => {
    let requestData;
    
    // 根据不同模式构建请求数据
    if (currentRecipientMode === 'single') {
      // 单一地址模式
      const toAddress = batchToAddressInput.value;
      const amountPerWallet = batchTransferForm.querySelector('input[name="amount_per_wallet"]').value;
      const memo = batchTransferForm.querySelector('input[name="memo"]').value;
      
      if (!toAddress || !amountPerWallet || selectedBatchWallets.size === 0) {
        alertMsg('请填写完整的批量转账信息并选择钱包');
        return;
      }
      
      requestData = {
        from_wallet_ids: Array.from(selectedBatchWallets),
        to_address: toAddress,
        amount_per_wallet: parseFloat(amountPerWallet),
        memo: memo
      };
      
    } else if (currentRecipientMode === 'multiple') {
      // 多个地址模式
      const recipients = [];
      const recipientItems = recipientList.querySelectorAll('.recipient-item');
      
      for (const item of recipientItems) {
        const address = item.querySelector('.recipient-address').value;
        const amount = item.querySelector('.recipient-amount').value;
        
        if (!address || !amount) {
          alertMsg('请填写完整的接收方信息');
          return;
        }
        
        recipients.push({
          address: address,
          amount: parseFloat(amount)
        });
      }
      
      if (recipients.length === 0 || selectedBatchWallets.size === 0) {
        alertMsg('请添加接收方并选择发送钱包');
        return;
      }
      
      requestData = {
        from_wallet_ids: Array.from(selectedBatchWallets),
        recipients: recipients,
        memo: batchTransferForm.querySelector('input[name="memo"]').value
      };
      
    } else if (currentRecipientMode === 'internal') {
      // 内部分发模式
      if (selectedBatchWallets.size === 0 || selectedInternalWallets.size === 0) {
        alertMsg('请选择发送钱包和接收钱包');
        return;
      }
      
      const amountPerWallet = batchTransferForm.querySelector('input[name="amount_per_wallet"]').value;
      if (!amountPerWallet) {
        alertMsg('请设置转账金额');
        return;
      }
      
      // 将选中的内部钱包地址转换为钱包ID
      const selectedInternalWalletIds = [];
      selectedInternalWallets.forEach(address => {
        const wallet = userWallets.find(w => w.public_key === address);
        if (wallet) {
          selectedInternalWalletIds.push(wallet.id);
        }
      });
      
      requestData = {
        from_wallet_ids: Array.from(selectedBatchWallets),
        to_wallet_ids: selectedInternalWalletIds,
        amount_per_wallet: parseFloat(amountPerWallet),
        memo: batchTransferForm.querySelector('input[name="memo"]').value
      };
    }
    
    const originalText = previewBatchTransferBtn.innerHTML;
    previewBatchTransferBtn.innerHTML = '<span class="btn-icon">⏳</span> 预览中...';
    previewBatchTransferBtn.disabled = true;
    
    try {
      let endpoint;
      switch (currentRecipientMode) {
        case 'single':
          endpoint = '/api/transfer/batch-prepare';
          break;
        case 'multiple':
          endpoint = '/api/transfer/batch-prepare-multiple';
          break;
        case 'internal':
          endpoint = '/api/transfer/batch-prepare-internal';
          break;
      }
      
      const r = await authFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData)
      });
      
      if (!r.ok) {
        const error = await r.json();
        throw new Error(error.detail || '预览失败');
      }
      
      const result = await r.json();
      
      // 显示预览信息
      displayBatchPreview(result);
      
      if (batchTransferPreview) batchTransferPreview.style.display = 'block';
      const executeBtn = $('#executeBatchTransferBtn');
      if (executeBtn) executeBtn.style.display = 'inline-flex';
      
      if (result.insufficient_wallets > 0) {
        alertMsg(`注意：有 ${result.insufficient_wallets} 个钱包余额不足，将跳过这些钱包`);
      }
      
    } catch (e) {
      alertMsg(e.message);
    } finally {
      previewBatchTransferBtn.innerHTML = originalText;
      previewBatchTransferBtn.disabled = false;
    }
  });
}

const displayBatchPreview = (result) => {
  // 根据模式显示不同的预览信息
  const batchPreviewTo = $('#batchPreviewTo');
  const batchPreviewWalletCount = $('#batchPreviewWalletCount');
  const batchPreviewAmountPer = $('#batchPreviewAmountPer');
  const batchPreviewTotalAmount = $('#batchPreviewTotalAmount');
  const batchPreviewTotalFee = $('#batchPreviewTotalFee');
  const batchPreviewGrandTotal = $('#batchPreviewGrandTotal');
  const batchPreviewDetails = $('#batchPreviewDetails');
  
  if (currentRecipientMode === 'single') {
    if (batchPreviewTo) batchPreviewTo.textContent = `${result.to_address.slice(0, 8)}...${result.to_address.slice(-4)}`;
    if (batchPreviewWalletCount) batchPreviewWalletCount.textContent = `${result.sufficient_wallets}/${result.total_wallets} 个钱包`;
    if (batchPreviewAmountPer) batchPreviewAmountPer.textContent = `${result.amount_per_wallet.toFixed(6)} SOL`;
    if (batchPreviewTotalAmount) batchPreviewTotalAmount.textContent = `${result.total_transfer_amount.toFixed(6)} SOL`;
    if (batchPreviewTotalFee) batchPreviewTotalFee.textContent = `${result.total_fees.toFixed(6)} SOL`;
    if (batchPreviewGrandTotal) batchPreviewGrandTotal.textContent = `${result.total_required.toFixed(6)} SOL`;
  } else if (currentRecipientMode === 'multiple') {
    if (batchPreviewTo) batchPreviewTo.textContent = `${result.recipients.length} 个不同地址`;
    if (batchPreviewWalletCount) batchPreviewWalletCount.textContent = `${result.sufficient_wallets}/${result.total_wallets} 个钱包`;
    if (batchPreviewAmountPer) batchPreviewAmountPer.textContent = '各不相同';
    if (batchPreviewTotalAmount) batchPreviewTotalAmount.textContent = `${result.total_transfer_amount.toFixed(6)} SOL`;
    if (batchPreviewTotalFee) batchPreviewTotalFee.textContent = `${result.total_fees.toFixed(6)} SOL`;
    if (batchPreviewGrandTotal) batchPreviewGrandTotal.textContent = `${result.total_required.toFixed(6)} SOL`;
  } else if (currentRecipientMode === 'internal') {
    if (batchPreviewTo) batchPreviewTo.textContent = `${selectedInternalWallets.size} 个内部钱包`;
    if (batchPreviewWalletCount) batchPreviewWalletCount.textContent = `${result.sufficient_wallets}/${result.total_wallets} 个钱包`;
    if (batchPreviewAmountPer) batchPreviewAmountPer.textContent = `${result.amount_per_wallet.toFixed(6)} SOL`;
    if (batchPreviewTotalAmount) batchPreviewTotalAmount.textContent = `${result.total_transfer_amount.toFixed(6)} SOL`;
    if (batchPreviewTotalFee) batchPreviewTotalFee.textContent = `${result.total_fees.toFixed(6)} SOL`;
    if (batchPreviewGrandTotal) batchPreviewGrandTotal.textContent = `${result.total_required.toFixed(6)} SOL`;
  }
  
  // 显示详细信息
  if (batchPreviewDetails) {
    const detailsHtml = result.transfers.map(t => `
      <div class="batch-detail-item ${!t.sufficient ? 'insufficient' : ''}">
        <span>${t.wallet_name || '未命名'}</span>
        <span>${t.current_balance.toFixed(4)} SOL</span>
        <span>${t.sufficient ? '✅' : '❌'}</span>
        <span>${t.sufficient ? '可转账' : '余额不足'}</span>
      </div>
    `).join('');
    
    batchPreviewDetails.innerHTML = detailsHtml;
  }
};

/* ---------- 转账记录管理 ---------- */
const loadTransferRecords = async () => {
  const transferRecordsEl = $('#transferRecords');
  if (!transferRecordsEl) return;
  
  if (!JWT) {
    transferRecordsEl.innerHTML = '<p class="muted">请先登录查看转账记录</p>';
    return;
  }
  
  try {
    const response = await authFetch('/api/transfer/records?limit=20');
    if (!response.ok) {
      throw new Error('获取转账记录失败');
    }
    
    const records = await response.json();
    displayTransferRecords(records);
    
  } catch (error) {
    console.error('加载转账记录失败:', error);
    transferRecordsEl.innerHTML = '<p class="muted">加载转账记录失败</p>';
  }
};

const displayTransferRecords = (records) => {
  const recordsEl = $('#transferRecords');
  if (!recordsEl) return;
  
  if (records.length === 0) {
    recordsEl.innerHTML = '<p class="muted">暂无转账记录</p>';
    return;
  }
  
  const getStatusIcon = (status) => {
    switch (status) {
      case 'confirmed': return '✅';
      case 'failed': return '❌';
      case 'pending': return '⏳';
      default: return '🔄';
    }
  };
  
  const getStatusText = (status) => {
    switch (status) {
      case 'confirmed': return '已确认';
      case 'failed': return '失败';
      case 'pending': return '待确认';
      default: return '处理中';
    }
  };
  
  const formatAddress = (address) => {
    return `${address.slice(0, 8)}...${address.slice(-4)}`;
  };
  
  recordsEl.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>时间</th>
          <th>发送方</th>
          <th>接收方</th>
          <th>金额 (SOL)</th>
          <th>状态</th>
          <th>类型</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        ${records.map(record => `
          <tr>
            <td style="font-size: 12px;">
              ${new Date(record.created).toLocaleString()}
            </td>
            <td style="font-family: monospace; font-size: 12px;">
              ${formatAddress(record.from_address)}
            </td>
            <td style="font-family: monospace; font-size: 12px;">
              ${formatAddress(record.to_address)}
            </td>
            <td style="font-weight: 600; color: var(--accent-color);">
              ${record.amount.toFixed(6)}
            </td>
            <td>
              <span style="display: flex; align-items: center; gap: 4px; font-size: 12px;">
                ${getStatusIcon(record.status)}
                ${getStatusText(record.status)}
              </span>
            </td>
            <td>
              <span style="padding: 2px 6px; border-radius: 4px; font-size: 11px; 
                    background: ${record.transfer_type === 'single' ? '#e3f2fd' : '#fff3e0'}; 
                    color: ${record.transfer_type === 'single' ? '#1976d2' : '#f57c00'};">
                ${record.transfer_type === 'single' ? '单笔' : '批量'}
              </span>
            </td>
            <td>
              ${record.signature ? `
                <button class="copy" data-sig="${record.signature}" style="font-size: 11px; padding: 4px 8px;">
                  📋 签名
                </button>
              ` : '-'}
            </td>
          </tr>
          ${record.memo ? `
            <tr style="background: #f9f9f9;">
              <td colspan="7" style="font-size: 12px; color: var(--text-secondary); padding: 8px 12px;">
                💬 备注: ${record.memo}
              </td>
            </tr>
          ` : ''}
          ${record.error_message ? `
            <tr style="background: #ffebee;">
              <td colspan="7" style="font-size: 12px; color: #c62828; padding: 8px 12px;">
                ❌ 错误: ${record.error_message}
              </td>
            </tr>
          ` : ''}
        `).join('')}
      </tbody>
    </table>
  `;
  
  // 绑定复制签名功能
  recordsEl.addEventListener('click', (e) => {
    if (e.target.classList.contains('copy')) {
      const signature = e.target.dataset.sig;
      navigator.clipboard.writeText(signature).then(() => {
        const originalText = e.target.textContent;
        e.target.textContent = '✅ 已复制';
        e.target.style.background = 'var(--success-color)';
        setTimeout(() => {
          e.target.textContent = originalText;
          e.target.style.background = 'var(--accent-color)';
        }, 2000);
      }).catch(() => {
        alert(`请手动复制签名: ${signature}`);
      });
    }
  });
};

/* ---------- 弹窗管理 ---------- */
const showImportModal = () => {
  if (importModal) {
    importModal.hidden = false;
    if (importTextarea) importTextarea.focus();
  }
};

const hideImportModal = () => {
  if (importModal) {
    importModal.hidden = true;
    if (importTextarea) importTextarea.value = '';
  }
};

// 弹窗事件绑定
const importBtn = $('#importBtn');
if (importBtn) importBtn.onclick = showImportModal;
if (importCancel) importCancel.onclick = hideImportModal;
if (modalClose) modalClose.onclick = hideImportModal;

// 点击背景关闭弹窗
if (importModal) {
  importModal.onclick = (e) => {
    if (e.target === importModal) {
      hideImportModal();
    }
  };
}

// ESC 键关闭弹窗
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && importModal && !importModal.hidden) {
    hideImportModal();
  }
});

// 拖拽文件读取
if (importTextarea) {
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
}

// 导入确认
if (importConfirm) {
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
}

/* ---------- 钱包操作 ---------- */

// 导出钱包
const exportBtn = $('#exportBtn');
if (exportBtn) {
  exportBtn.onclick = async () => {
    if (selectedWallets.size === 0) {
      alertMsg('请选择要导出的钱包');
      return;
    }
    
    const originalText = exportBtn.innerHTML;
    exportBtn.innerHTML = '<span class="btn-icon">⏳</span> 导出中...';
    exportBtn.disabled = true;
    
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
      exportBtn.innerHTML = originalText;
      exportBtn.disabled = selectedWallets.size === 0;
    }
  };
}

// 查询余额
const balanceBtn = $('#balanceBtn');
if (balanceBtn) {
  balanceBtn.onclick = async () => {
    if (selectedWallets.size === 0) {
      alertMsg('请选择要查询余额的钱包');
      return;
    }
    
    const originalText = balanceBtn.innerHTML;
    balanceBtn.innerHTML = '<span class="btn-icon">⏳</span> 查询中...';
    balanceBtn.disabled = true;
    if (totalBalanceBox) totalBalanceBox.classList.add('loading');
    
    try {
      const r = await authFetch('/api/wallets/balances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Array.from(selectedWallets))
      });
      
      if (!r.ok) throw new Error('查询失败');
      
      const result = await r.json();
      
      // 更新总余额显示
      const totalBalance = $('#totalBalance');
      const walletCount = $('#walletCount');
      const lastUpdate = $('#lastUpdate');
      
      if (totalBalance) totalBalance.textContent = result.total.toFixed(4);
      if (walletCount) walletCount.textContent = result.count;
      if (lastUpdate) lastUpdate.textContent = new Date().toLocaleTimeString();
      if (totalBalanceBox) {
        totalBalanceBox.style.display = 'block';
        totalBalanceBox.classList.remove('loading');
      }
      
      // 重新加载钱包列表以显示更新的余额
      await loadWallets();
      
      // 恢复选中状态
      selectedWallets.forEach(id => {
        const checkbox = $(`.wallet-select[value="${id}"]`);
        if (checkbox) checkbox.checked = true;
      });
      
    } catch (e) {
      alertMsg('查询余额失败: ' + e.message);
      if (totalBalanceBox) totalBalanceBox.classList.remove('loading');
    } finally {
      balanceBtn.innerHTML = originalText;
      balanceBtn.disabled = selectedWallets.size === 0;
    }
  };
}

// 删除钱包
const deleteBtn = $('#deleteBtn');
if (deleteBtn) {
  deleteBtn.onclick = async () => {
    if (selectedWallets.size === 0) {
      alertMsg('请选择要删除的钱包');
      return;
    }
    
    const confirmed = confirm(
      `⚠️ 确定要删除 ${selectedWallets.size} 个钱包吗？\n\n此操作不可恢复，请确保已备份重要钱包！`
    );
    
    if (!confirmed) return;
    
    const originalText = deleteBtn.innerHTML;
    deleteBtn.innerHTML = '<span class="btn-icon">⏳</span> 删除中...';
    deleteBtn.disabled = true;
    
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
      if (totalBalanceBox) totalBalanceBox.style.display = 'none';
      loadWallets();
      
    } catch (e) {
      alertMsg('删除失败: ' + e.message);
    } finally {
      deleteBtn.innerHTML = originalText;
      deleteBtn.disabled = true; // 删除后禁用，等待重新选择
    }
  };
}

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
  console.log('🚀 开始初始化 Solana 工具站...');
  
  // 检查关键元素是否存在
  console.log('🔍 检查关键元素:');
  console.log('  - loginBtn:', !!loginBtn);
  console.log('  - pages:', Object.keys(pages).filter(key => pages[key]).length + '/' + Object.keys(pages).length);
  console.log('  - navLinks:', navLinks.length);
  console.log('  - batchWalletGrid:', !!batchWalletGrid);
  
  // 渲染登录状态
  renderLogin();
  console.log('✅ 登录状态已渲染');
  
  // 显示默认页面
  showPage('generate');
  console.log('✅ 默认页面已显示');
  
  // 如果已登录，加载对应数据
  if (JWT) {
    console.log('🔐 检测到已登录状态，加载用户数据...');
    loadHist();
  }
  
  // 初始化转账控制器（如果transfer.js已加载）
  if (window.TransferController) {
    window.transferController = new window.TransferController();
    console.log('💸 转账控制器已初始化');
  } else {
    console.log('⏳ 转账控制器等待transfer.js加载...');
  }
  
  console.log('🎉 Solana 工具站初始化完成');
});

// 设置全局 authFetch 以供其他模块使用
window.authFetch = authFetch;
window.alertMsg = alertMsg;
window.currentRecipientMode = currentRecipientMode;
window.selectedBatchWallets = selectedBatchWallets;
window.selectedInternalWallets = selectedInternalWallets;
window.fromWalletSelectorInstance = fromWalletSelectorInstance;
window.userWallets = userWallets;
window.updateSelectedBatchWallets = updateSelectedBatchWallets;
window.addRecipient = addRecipient;
window.loadTransferRecords = loadTransferRecords;