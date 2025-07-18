/* ---------- Solana Web3.js 动态加载 ---------- */
let solanaWeb3;
const solanaWeb3Ready = new Promise(async (resolve) => {
  try {
    // 尝试从CDN加载Solana Web3.js
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/@solana/web3.js@latest/lib/index.iife.min.js';
    script.onload = () => {
      solanaWeb3 = window.solanaWeb3;
      resolve();
    };
    script.onerror = () => {
      console.warn('无法加载Solana Web3.js，转账功能将受限');
      resolve();
    };
    document.head.appendChild(script);
  } catch (e) {
    console.warn('Solana Web3.js加载失败:', e);
    resolve();
  }
});

/* ---------- 转账执行器 ---------- */
class TransferExecutor {
  constructor() {
    this.connection = null;
    this.isReady = false;
    this.init();
  }

  async init() {
    await solanaWeb3Ready;
    if (solanaWeb3) {
      // 使用主网RPC
      this.connection = new solanaWeb3.Connection('https://api.mainnet-beta.solana.com');
      this.isReady = true;
      console.log('🔗 Solana连接已建立');
    } else {
      console.warn('⚠️ Solana Web3.js未加载，将使用模拟模式');
    }
  }

  async executeTransfer(transferData) {
    if (!this.isReady || !window.solana?.isPhantom) {
      throw new Error('需要Phantom钱包和Solana Web3.js支持');
    }

    try {
      const { instruction, recent_blockhash, memo } = transferData;
      
      // 创建转账指令
      const fromPubkey = new solanaWeb3.PublicKey(instruction.fromPubkey);
      const toPubkey = new solanaWeb3.PublicKey(instruction.toPubkey);
      
      const transferInstruction = solanaWeb3.SystemProgram.transfer({
        fromPubkey,
        toPubkey,
        lamports: instruction.lamports
      });

      const instructions = [transferInstruction];

      // 如果有备注，添加备注指令
      if (memo) {
        const memoInstruction = new solanaWeb3.TransactionInstruction({
          keys: [{ pubkey: fromPubkey, isSigner: true, isWritable: false }],
          data: Buffer.from(memo, 'utf8'),
          programId: new solanaWeb3.PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr')
        });
        instructions.push(memoInstruction);
      }

      // 创建交易
      const transaction = new solanaWeb3.Transaction({
        recentBlockhash: recent_blockhash,
        feePayer: fromPubkey
      });

      instructions.forEach(instruction => transaction.add(instruction));

      // 使用Phantom钱包签名
      const signedTransaction = await window.solana.signTransaction(transaction);
      
      // 广播交易
      const signature = await this.connection.sendRawTransaction(
        signedTransaction.serialize(),
        {
          skipPreflight: false,
          preflightCommitment: 'processed'
        }
      );

      // 等待确认
      const confirmation = await this.connection.confirmTransaction(signature);
      
      if (confirmation.value.err) {
        throw new Error(`交易失败: ${confirmation.value.err}`);
      }

      return {
        signature,
        success: true,
        confirmations: 1
      };

    } catch (error) {
      console.error('转账执行失败:', error);
      throw error;
    }
  }

  async executeBatchTransfer(batchData) {
    if (!this.isReady || !window.solana?.isPhantom) {
      throw new Error('需要Phantom钱包和Solana Web3.js支持');
    }

    const { transfer_instructions, recent_blockhash, memo } = batchData;
    const results = [];

    for (const instructionData of transfer_instructions) {
      try {
        const transferData = {
          instruction: instructionData.instruction,
          recent_blockhash,
          memo
        };

        const result = await this.executeTransfer(transferData);
        
        results.push({
          transfer_id: instructionData.transfer_id,
          wallet_id: instructionData.wallet_id,
          signature: result.signature,
          success: true
        });

        // 添加延迟防止RPC限制
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        results.push({
          transfer_id: instructionData.transfer_id,
          wallet_id: instructionData.wallet_id,
          error: error.message,
          success: false
        });
      }
    }

    return results;
  }

  async checkTransactionStatus(signature) {
    if (!this.isReady) {
      return { confirmed: false, error: 'Web3连接未就绪' };
    }

    try {
      const status = await this.connection.getSignatureStatus(signature);
      return {
        confirmed: status.value?.confirmationStatus === 'finalized',
        confirmations: status.value?.confirmations || 0,
        error: status.value?.err
      };
    } catch (error) {
      return { confirmed: false, error: error.message };
    }
  }
}

/* ---------- 转账UI控制器 ---------- */
class TransferController {
  constructor() {
    this.executor = new TransferExecutor();
    this.currentTransfers = new Map(); // 跟踪当前转账
    this.init();
  }

  init() {
    this.setupEventListeners();
  }

  setupEventListeners() {
    // 确保DOM元素存在后再绑定事件
    const checkAndBind = () => {
      const executeTransferBtn = document.getElementById('executeTransferBtn');
      const executeBatchTransferBtn = document.getElementById('executeBatchTransferBtn');
      
      if (executeTransferBtn && !executeTransferBtn.hasAttribute('data-transfer-bound')) {
        executeTransferBtn.addEventListener('click', () => this.handleSingleTransfer());
        executeTransferBtn.setAttribute('data-transfer-bound', 'true');
        console.log('✅ 单笔转账按钮事件已绑定');
      }
      
      if (executeBatchTransferBtn && !executeBatchTransferBtn.hasAttribute('data-batch-bound')) {
        executeBatchTransferBtn.addEventListener('click', () => this.handleBatchTransfer());
        executeBatchTransferBtn.setAttribute('data-batch-bound', 'true');
        console.log('✅ 批量转账按钮事件已绑定');
      }
    };

    // 立即检查
    checkAndBind();
    
    // 设置定时检查，确保页面动态加载的元素也能绑定事件
    const checkInterval = setInterval(() => {
      checkAndBind();
    }, 1000);

    // 5秒后停止检查
    setTimeout(() => {
      clearInterval(checkInterval);
    }, 5000);
  }

  async handleSingleTransfer() {
    if (!confirm('⚠️ 确认执行转账？\n\n转账一旦确认将无法撤销，请仔细核对转账信息！')) {
      return;
    }

    const btn = document.getElementById('executeTransferBtn');
    if (!btn) return;

    const originalText = btn.innerHTML;
    btn.innerHTML = '<span class="btn-icon">⏳</span> 执行中...';
    btn.disabled = true;

    try {
      // 获取表单数据
      const selectedFromAddress = document.getElementById('selectedFromAddress');
      const toAddressInput = document.getElementById('toAddressInput');
      const singleTransferForm = document.getElementById('singleTransferForm');
      
      if (!selectedFromAddress || !toAddressInput || !singleTransferForm) {
        throw new Error('转账表单元素不完整');
      }

      const fromAddress = selectedFromAddress.value;
      const toAddress = toAddressInput.value;
      const amountInput = singleTransferForm.querySelector('input[name="amount"]');
      const memoInput = singleTransferForm.querySelector('input[name="memo"]');
      
      if (!amountInput) {
        throw new Error('找不到金额输入框');
      }

      const amount = parseFloat(amountInput.value);
      const memo = memoInput ? memoInput.value : '';

      if (!fromAddress || !toAddress || !amount) {
        throw new Error('请填写完整的转账信息');
      }

      const transferRequest = {
        from_address: fromAddress,
        to_address: toAddress,
        amount: amount,
        memo: memo
      };

      // 1. 调用后端准备转账
      const prepareResponse = await window.authFetch('/api/transfer/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(transferRequest)
      });

      if (!prepareResponse.ok) {
        const error = await prepareResponse.json();
        throw new Error(error.detail || '准备转账失败');
      }

      const transferData = await prepareResponse.json();
      
      // 2. 执行转账
      showTransferProgress('正在签名交易...', 'pending');
      
      const result = await this.executor.executeTransfer(transferData);
      
      // 3. 确认转账
      await window.authFetch('/api/transfer/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transfer_id: transferData.transfer_id,
          signature: result.signature
        })
      });

      // 4. 显示成功信息
      showTransferProgress(
        `转账成功！\n签名: ${result.signature}\n\n正在等待网络确认...`,
        'success'
      );

      // 5. 开始监控交易状态
      this.monitorTransfer(result.signature, transferData.transfer_id);

      // 重置表单
      singleTransferForm.reset();
      const fromWalletSelectorInstance = window.fromWalletSelectorInstance;
      if (fromWalletSelectorInstance) {
        fromWalletSelectorInstance.reset();
      }
      
      const transferPreview = document.getElementById('transferPreview');
      if (transferPreview) {
        transferPreview.style.display = 'none';
      }
      
      btn.style.display = 'none';

    } catch (error) {
      console.error('转账失败:', error);
      showTransferProgress(`转账失败: ${error.message}`, 'error');
    } finally {
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  }

  async handleBatchTransfer() {
    if (!confirm('⚠️ 确认执行批量转账？\n\n这将执行多笔转账交易，请确保所有信息正确！')) {
      return;
    }

    const btn = document.getElementById('executeBatchTransferBtn');
    if (!btn) return;

    const originalText = btn.innerHTML;
    btn.innerHTML = '<span class="btn-icon">⏳</span> 执行中...';
    btn.disabled = true;

    try {
      let batchRequest;
      let endpoint;

      // 获取当前接收方模式
      const currentRecipientMode = window.currentRecipientMode || 'single';
      const selectedBatchWallets = window.selectedBatchWallets || new Set();
      const selectedInternalWallets = window.selectedInternalWallets || new Set();

      // 根据不同模式构建请求数据
      if (currentRecipientMode === 'single') {
        const batchToAddressInput = document.getElementById('batchToAddressInput');
        const batchTransferForm = document.getElementById('batchTransferForm');
        
        if (!batchToAddressInput || !batchTransferForm) {
          throw new Error('批量转账表单元素不完整');
        }

        const toAddress = batchToAddressInput.value;
        const amountInput = batchTransferForm.querySelector('input[name="amount_per_wallet"]');
        const memoInput = batchTransferForm.querySelector('input[name="memo"]');
        
        if (!amountInput) {
          throw new Error('找不到金额输入框');
        }

        const amountPerWallet = parseFloat(amountInput.value);
        const memo = memoInput ? memoInput.value : '';

        if (!toAddress || !amountPerWallet || selectedBatchWallets.size === 0) {
          throw new Error('请填写完整的批量转账信息并选择钱包');
        }

        batchRequest = {
          from_wallet_ids: Array.from(selectedBatchWallets),
          to_address: toAddress,
          amount_per_wallet: amountPerWallet,
          memo: memo
        };
        endpoint = '/api/transfer/batch-execute';

      } else if (currentRecipientMode === 'multiple') {
        const recipientList = document.getElementById('recipientList');
        const batchTransferForm = document.getElementById('batchTransferForm');
        
        if (!recipientList || !batchTransferForm) {
          throw new Error('多地址转账表单元素不完整');
        }

        const recipients = [];
        const recipientItems = recipientList.querySelectorAll('.recipient-item');
        
        for (const item of recipientItems) {
          const addressInput = item.querySelector('.recipient-address');
          const amountInput = item.querySelector('.recipient-amount');
          
          if (!addressInput || !amountInput) {
            throw new Error('接收方信息不完整');
          }

          const address = addressInput.value;
          const amount = parseFloat(amountInput.value);
          
          if (!address || !amount) {
            throw new Error('请填写完整的接收方信息');
          }
          
          recipients.push({ address, amount });
        }

        if (recipients.length === 0 || selectedBatchWallets.size === 0) {
          throw new Error('请添加接收方并选择发送钱包');
        }

        const memoInput = batchTransferForm.querySelector('input[name="memo"]');
        batchRequest = {
          from_wallet_ids: Array.from(selectedBatchWallets),
          recipients: recipients,
          memo: memoInput ? memoInput.value : ''
        };
        endpoint = '/api/transfer/batch-execute-multiple';

      } else if (currentRecipientMode === 'internal') {
        const batchTransferForm = document.getElementById('batchTransferForm');
        
        if (!batchTransferForm) {
          throw new Error('内部转账表单元素不完整');
        }

        if (selectedBatchWallets.size === 0 || selectedInternalWallets.size === 0) {
          throw new Error('请选择发送钱包和接收钱包');
        }
        
        const amountInput = batchTransferForm.querySelector('input[name="amount_per_wallet"]');
        if (!amountInput) {
          throw new Error('找不到金额输入框');
        }

        const amountPerWallet = parseFloat(amountInput.value);
        if (!amountPerWallet) {
          throw new Error('请设置转账金额');
        }

        // 获取选中的内部钱包ID（从地址转换为ID）
        const selectedInternalWalletIds = [];
        const userWallets = window.userWallets || [];
        selectedInternalWallets.forEach(address => {
          const wallet = userWallets.find(w => w.public_key === address);
          if (wallet) {
            selectedInternalWalletIds.push(wallet.id);
          }
        });

        const memoInput = batchTransferForm.querySelector('input[name="memo"]');
        batchRequest = {
          from_wallet_ids: Array.from(selectedBatchWallets),
          to_wallet_ids: selectedInternalWalletIds,
          amount_per_wallet: amountPerWallet,
          memo: memoInput ? memoInput.value : ''
        };
        endpoint = '/api/transfer/batch-execute-internal';
      }

      // 1. 调用后端准备批量转账
      const prepareResponse = await window.authFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batchRequest)
      });

      if (!prepareResponse.ok) {
        const error = await prepareResponse.json();
        throw new Error(error.detail || '准备批量转账失败');
      }

      const batchData = await prepareResponse.json();
      
      // 2. 执行批量转账
      showTransferProgress(
        `开始执行批量转账...\n总计 ${batchData.total_transfers} 笔交易`,
        'pending'
      );
      
      const results = await this.executor.executeBatchTransfer(batchData);
      
      // 3. 确认批量转账结果
      const confirmEndpoint = endpoint.replace('-execute', '-confirm');
      await window.authFetch(confirmEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batch_id: batchData.batch_id,
          results: results.map(r => ({
            transfer_id: r.transfer_id,
            signature: r.signature,
            error: r.error
          }))
        })
      });

      // 4. 显示结果统计
      const successful = results.filter(r => r.success).length;
      const failed = results.length - successful;
      
      showTransferProgress(
        `批量转账完成！\n✅ 成功: ${successful} 笔\n❌ 失败: ${failed} 笔\n\n查看转账记录了解详情`,
        successful > 0 ? 'success' : 'error'
      );

      // 重置表单和选择
      const batchTransferForm = document.getElementById('batchTransferForm');
      if (batchTransferForm) {
        batchTransferForm.reset();
      }
      
      selectedBatchWallets.clear();
      selectedInternalWallets.clear();
      
      // 更新选择状态
      if (window.updateSelectedBatchWallets) {
        window.updateSelectedBatchWallets();
      }
      
      // 清空内部钱包选择状态
      const internalWalletGrid = document.getElementById('internalWalletGrid');
      if (internalWalletGrid) {
        internalWalletGrid.querySelectorAll('.internal-wallet-select').forEach(checkbox => {
          checkbox.checked = false;
        });
        internalWalletGrid.querySelectorAll('.internal-wallet-item').forEach(item => {
          item.classList.remove('selected');
        });
      }
      
      const batchTransferPreview = document.getElementById('batchTransferPreview');
      if (batchTransferPreview) {
        batchTransferPreview.style.display = 'none';
      }
      
      btn.style.display = 'none';

      // 清空接收方列表（多地址模式）
      if (currentRecipientMode === 'multiple') {
        const recipientList = document.getElementById('recipientList');
        if (recipientList) {
          recipientList.innerHTML = '';
          // 重新添加一个默认项
          if (window.addRecipient) {
            window.addRecipient();
          }
        }
      }

      // 重新加载转账记录
      if (window.loadTransferRecords) {
        await window.loadTransferRecords();
      }

    } catch (error) {
      console.error('批量转账失败:', error);
      showTransferProgress(`批量转账失败: ${error.message}`, 'error');
    } finally {
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  }

  async monitorTransfer(signature, transferId) {
    let attempts = 0;
    const maxAttempts = 30; // 最多检查30次（约5分钟）

    const checkStatus = async () => {
      try {
        attempts++;
        
        const response = await window.authFetch(`/api/transfer/status/${signature}`);
        if (response.ok) {
          const status = await response.json();
          
          if (status.confirmed) {
            if (status.error) {
              showTransferProgress(
                `交易失败 ❌\n签名: ${signature}\n错误: ${status.error}`,
                'error'
              );
            } else {
              showTransferProgress(
                `交易已确认 ✅\n签名: ${signature}\n区块高度: ${status.block_height}`,
                'success'
              );
            }
            return;
          }
        }
        
        // 如果还未确认且未达到最大尝试次数，继续检查
        if (attempts < maxAttempts) {
          setTimeout(checkStatus, 10000); // 每10秒检查一次
        } else {
          showTransferProgress(
            `转账确认超时 ⏰\n签名: ${signature}\n请稍后在转账记录中查看状态`,
            'warning'
          );
        }
        
      } catch (error) {
        console.error('检查转账状态失败:', error);
      }
    };

    // 开始监控
    setTimeout(checkStatus, 5000); // 5秒后开始第一次检查
  }
}

/* ---------- 转账进度显示 ---------- */
function showTransferProgress(message, type = 'info') {
  // 创建进度弹窗
  let progressModal = document.getElementById('transferProgressModal');
  if (!progressModal) {
    progressModal = document.createElement('div');
    progressModal.id = 'transferProgressModal';
    progressModal.className = 'modal';
    progressModal.innerHTML = `
      <div class="modal-content transfer-progress">
        <div class="progress-header">
          <h3>💸 转账进度</h3>
          <button class="modal-close" onclick="hideTransferProgress()">✕</button>
        </div>
        <div class="progress-body">
          <div class="progress-icon"></div>
          <div class="progress-message"></div>
        </div>
        <div class="progress-footer">
          <button class="modal-btn secondary" onclick="hideTransferProgress()">关闭</button>
        </div>
      </div>
    `;
    document.body.appendChild(progressModal);
  }

  const icon = progressModal.querySelector('.progress-icon');
  const messageEl = progressModal.querySelector('.progress-message');
  
  // 设置图标和样式
  const icons = {
    pending: '⏳',
    success: '✅', 
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️'
  };
  
  if (icon) icon.textContent = icons[type] || icons.info;
  if (messageEl) {
    messageEl.textContent = message;
    messageEl.className = `progress-message ${type}`;
  }
  
  progressModal.hidden = false;
}

function hideTransferProgress() {
  const progressModal = document.getElementById('transferProgressModal');
  if (progressModal) {
    progressModal.hidden = true;
  }
}

/* ---------- 转账记录管理 ---------- */
async function loadTransferRecords() {
  const JWT = localStorage.getItem('walletJWT');
  if (!JWT) return;
  
  try {
    const response = await window.authFetch('/api/transfer/records?limit=20');
    if (response.ok) {
      const records = await response.json();
      displayTransferRecords(records);
    }
  } catch (error) {
    console.error('加载转账记录失败:', error);
  }
}

function displayTransferRecords(records) {
  // 这里可以添加转账记录显示逻辑
  // 可以在转账页面添加一个记录查看区域
  console.log('转账记录:', records);
}

/* ---------- 初始化转账功能 ---------- */
let transferController;

// 确保在DOM完全加载后初始化
function initTransferController() {
  if (transferController) return;
  
  transferController = new TransferController();
  window.transferController = transferController;
  
  // 导出必要的函数到全局
  window.showTransferProgress = showTransferProgress;
  window.hideTransferProgress = hideTransferProgress;
  window.loadTransferRecords = loadTransferRecords;
  
  console.log('💸 转账控制器已初始化');
}

// 多种方式确保初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTransferController);
} else {
  initTransferController();
}

// 页面可见性变化时重新初始化（防止页面切换导致的问题）
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !window.transferController) {
    initTransferController();
  }
});

// 监听页面变化，确保转账页面激活时初始化
const observePageChanges = () => {
  const transferPage = document.getElementById('transferPage');
  if (transferPage) {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          if (transferPage.classList.contains('active') && !window.transferController) {
            initTransferController();
          }
        }
      });
    });
    
    observer.observe(transferPage, { attributes: true });
  }
};

// 延迟执行以确保DOM加载完成
setTimeout(observePageChanges, 1000);

// 导出给全局使用
window.TransferExecutor = TransferExecutor;
window.TransferController = TransferController;