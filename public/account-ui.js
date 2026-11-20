(function () {
  'use strict';
  let state = { user: null, quotaEnabled: false, welcomeCredits: 3, rewardProvider: 'disabled' };
  let nativeToken = '';
  try { if (location.protocol === 'file:') nativeToken = localStorage.getItem('sixyao-session') || ''; } catch {}
  const base = String(window.SIXYAO_API_BASE || '').replace(/\/$/, '');
  async function api(path, options = {}) {
    const { timeoutMs = 20000, ...requestOptions } = options;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
    const response = await fetch(base + path, {
      ...requestOptions,
      signal: requestOptions.signal || controller.signal,
      headers: { 'Content-Type': 'application/json', ...(nativeToken ? { Authorization: 'Bearer ' + nativeToken } : {}), ...options.headers }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || '暂时无法连接，请稍后重试');
      error.code = data.code;
      error.status = response.status;
      throw error;
    }
    return data;
    } catch (error) {
      if (controller.signal.aborted) {
        const timeoutError = new Error('请求超时，请检查网络后重试');
        timeoutError.name = 'TimeoutError';
        throw timeoutError;
      }
      throw error;
    } finally { clearTimeout(timeout); }
  }
  function canShowAd() {
    return state.rewardProvider !== 'disabled' &&
      window.SixYaoAds?.provider === state.rewardProvider &&
      typeof window.SixYaoAds.showRewarded === 'function';
  }
  function paint() {
    const bar = document.querySelector('#accountBar');
    if (!bar) return;
    bar.querySelector('span').textContent = state.user
      ? state.user.username + ' · AI 剩余 ' + state.user.credits + ' 次'
      : (state.quotaEnabled ? '排盘免费 · 注册赠送 ' + state.welcomeCredits + ' 次 AI 解读' : '摇卦排盘免费');
    bar.querySelector('button').textContent = state.user ? '我的次数' : '登录 / 注册';
    const balance = document.querySelector('#accountBalance');
    if (balance) balance.textContent = state.user ? 'AI 解读剩余 ' + state.user.credits + ' 次' : '请先登录账号';
    const adButton = document.querySelector('#watchReward');
    if (adButton) {
      adButton.disabled = !canShowAd();
      adButton.textContent = canShowAd() ? '看广告，获得 ' + state.rewardCredits + ' 次解读' : '激励广告暂未开放';
    }
    window.dispatchEvent(new CustomEvent('sixyao-account', { detail: state }));
  }
  async function refresh() {
    state = await api('/api/account');
    paint();
    return state;
  }
  function open() {
    document.querySelector('#accountDialog')?.remove();
    const dialog = document.createElement('dialog');
    dialog.id = 'accountDialog';
    dialog.className = 'account-dialog';
    dialog.setAttribute('aria-labelledby', 'accountTitle');
    dialog.innerHTML = '<button type="button" class="dialog-close" aria-label="关闭">×</button><h2 id="accountTitle">我的六爻</h2>' +
      (state.user
        ? '<p id="accountBalance"></p><p class="hint">网页和 APP 使用同一账号，共用 AI 解读次数。</p><button type="button" class="act primary" id="watchReward"></button><button type="button" class="act ghost" id="logoutAccount">退出登录</button>'
        : '<p class="hint">摇卦和排盘免费；首次注册赠送 ' + state.welcomeCredits + ' 次 AI 解读。</p><form id="accountForm"><label for="username">账号</label><input id="username" name="username" type="text" minlength="4" maxlength="32" pattern="[A-Za-z0-9_]{4,32}" autocomplete="username" placeholder="4–32 位字母、数字或下划线" required><label for="password">密码</label><input id="password" name="password" type="password" minlength="10" maxlength="128" autocomplete="current-password" placeholder="至少 10 个字符，请妥善保存" required><div class="btns"><button type="submit" class="act primary" name="action" value="login">登录</button><button type="submit" class="act gold-outline" name="action" value="register">注册账号</button></div></form>') +
      '<p id="accountMessage" class="hint" role="status" aria-live="polite"></p>';
    document.body.appendChild(dialog);
    const dismiss = () => { dialog.close(); dialog.remove(); };
    dialog.querySelector('.dialog-close').onclick = dismiss;
    dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dismiss(); } });
    dialog.showModal();
    paint();
    const message = dialog.querySelector('#accountMessage');
    const form = dialog.querySelector('form');
    if (form) form.onsubmit = async event => {
      event.preventDefault();
      const action = event.submitter?.value === 'register' ? 'register' : 'login';
      const buttons = [...form.querySelectorAll('button')];
      buttons.forEach(button => { button.disabled = true; });
      message.textContent = '正在处理…';
      try {
        const data = await api('/api/' + action, { method: 'POST', body: JSON.stringify({ username: form.elements.username.value, password: form.elements.password.value }) });
        if (data.token && location.protocol === 'file:') {
          nativeToken = data.token;
          try { localStorage.setItem('sixyao-session', nativeToken); } catch {}
        }
        state.user = data.user;
        await refresh();
        dismiss();
      } catch (error) { message.textContent = error.message; }
      finally { buttons.forEach(button => { button.disabled = false; }); }
    };
    const logout = dialog.querySelector('#logoutAccount');
    if (logout) logout.onclick = async () => {
      logout.disabled = true;
      try {
        await api('/api/logout', { method: 'POST', body: '{}' });
        nativeToken = '';
        try { localStorage.removeItem('sixyao-session'); } catch {}
        state.user = null;
        paint();
        dismiss();
      } catch (error) { message.textContent = error.message; logout.disabled = false; }
    };
    const watch = dialog.querySelector('#watchReward');
    if (watch) watch.onclick = async () => {
      watch.disabled = true;
      message.textContent = '正在加载广告…';
      try {
        const ticket = await api('/api/rewards/ticket', { method: 'POST', body: '{}' });
        // The installed, approved platform adapter handles the actual ad. It cannot grant credits.
        await window.SixYaoAds.showRewarded(ticket);
        message.textContent = '正在确认观看结果…';
        for (let attempt = 0; attempt < 15; attempt++) {
          const result = await api('/api/rewards/status?ticket=' + encodeURIComponent(ticket.ticket));
          if (result.rewarded) {
            await refresh();
            message.textContent = '奖励已到账，新增 ' + state.rewardCredits + ' 次解读';
            return;
          }
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        message.textContent = '奖励仍在确认中，稍后重新打开查看；请勿重复观看。';
      } catch (error) { message.textContent = error.message || '广告未完成，请稍后再试'; }
      finally { watch.disabled = !canShowAd(); }
    };
  }
  window.SixYaoAccount = {
    api, refresh, open,
    async beforeAI(retry = false) {
      await refresh();
      if (!state.quotaEnabled) return true;
      if (!state.user || (!retry && state.user.credits < 1)) { open(); return false; }
      return true;
    },
    get state() { return state; }
  };
  document.querySelector('#openAccount').onclick = () => {
    refresh().then(open).catch(error => {
      open();
      document.querySelector('#accountMessage').textContent = error.message;
    });
  };
  refresh().catch(() => {});
  if(location.protocol === 'file:') api('/api/visit', { method: 'POST', body: '{}' }).catch(() => {});
})();
