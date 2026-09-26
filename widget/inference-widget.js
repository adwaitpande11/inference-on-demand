/**
 * inference-widget.js — Self-contained Embeddable Lifecycle Widget
 * 
 * Usage:
 *   <div id="inference-widget-container"></div>
 *   <script 
 *     src="inference-widget.js" 
 *     data-api-url="https://<api-id>.execute-api.<region>.amazonaws.com" 
 *     data-token="<base64-encoded-user:pass>"
 *     data-container-id="inference-widget-container">
 *   </script>
 * 
 * Custom Events:
 *   window.addEventListener('ollamaReady', (e) => console.log(e.detail.endpoint));
 *   window.addEventListener('ollamaOffline', () => console.log('Ollama offline'));
 */

(function () {
  'use strict';

  // Discover script configuration
  const script = document.currentScript || document.querySelector('script[src*="inference-widget.js"]');
  const apiUrl = (script && script.getAttribute('data-api-url') || '').replace(/\/+$/, '');
  const authToken = script && script.getAttribute('data-token') || '';
  const containerId = script && script.getAttribute('data-container-id') || 'inference-widget-container';

  let state = 'UNKNOWN'; // UNKNOWN | TERMINATED | STARTING | READY | STOPPING
  let activeIp = '';
  let pollInterval = null;

  // DOM Container
  let container = document.getElementById(containerId);
  if (!container) {
    container = document.createElement('div');
    container.id = containerId;
    document.body.appendChild(container);
  }

  // Inject Styles
  const style = document.createElement('style');
  style.textContent = `
    .iod-widget {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: inline-flex;
      align-items: center;
      gap: 12px;
      padding: 8px 16px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      background: #ffffff;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
    }
    .iod-badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .iod-badge-unknown { background: #f1f5f9; color: #64748b; }
    .iod-badge-terminated { background: #f1f5f9; color: #475569; }
    .iod-badge-starting { background: #fef3c7; color: #92400e; }
    .iod-badge-ready { background: #dcfce7; color: #166534; }
    .iod-badge-stopping { background: #fee2e2; color: #991b1b; }
    .iod-btn {
      padding: 6px 14px;
      font-size: 13px;
      font-weight: 600;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      transition: background 0.15s ease-in-out;
    }
    .iod-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .iod-btn-start { background: #10b981; color: #ffffff; }
    .iod-btn-start:hover:not(:disabled) { background: #059669; }
    .iod-btn-stop { background: #ef4444; color: #ffffff; }
    .iod-btn-stop:hover:not(:disabled) { background: #dc2626; }
    .iod-endpoint { font-size: 12px; color: #3b82f6; text-decoration: none; font-family: monospace; }
  `;
  document.head.appendChild(style);

  // Render Widget UI
  container.innerHTML = `
    <div class="iod-widget">
      <span class="iod-badge iod-badge-unknown" id="iod-status">UNKNOWN</span>
      <button class="iod-btn iod-btn-start" id="iod-action-btn" disabled>Start</button>
      <span id="iod-endpoint-info" style="display:none;">
        <a class="iod-endpoint" id="iod-endpoint-link" target="_blank" rel="noopener"></a>
      </span>
    </div>
  `;

  const badgeEl = container.querySelector('#iod-status');
  const btnEl = container.querySelector('#iod-action-btn');
  const endpointInfoEl = container.querySelector('#iod-endpoint-info');
  const endpointLinkEl = container.querySelector('#iod-endpoint-link');

  function transitionTo(newState, data = {}) {
    state = newState;
    badgeEl.textContent = newState;
    badgeEl.className = `iod-badge iod-badge-${newState.toLowerCase()}`;

    switch (newState) {
      case 'TERMINATED':
        btnEl.textContent = 'Start';
        btnEl.className = 'iod-btn iod-btn-start';
        btnEl.disabled = false;
        endpointInfoEl.style.display = 'none';
        window.dispatchEvent(new CustomEvent('ollamaOffline'));
        break;

      case 'STARTING':
        btnEl.textContent = 'Starting...';
        btnEl.disabled = true;
        endpointInfoEl.style.display = 'none';
        break;

      case 'READY':
        btnEl.textContent = 'Stop';
        btnEl.className = 'iod-btn iod-btn-stop';
        btnEl.disabled = false;
        if (data.ip) {
          activeIp = data.ip;
          endpointLinkEl.textContent = `http://${data.ip}:11434`;
          endpointLinkEl.href = `http://${data.ip}:11434`;
          endpointInfoEl.style.display = 'inline';
        }
        window.dispatchEvent(new CustomEvent('ollamaReady', {
          detail: { endpoint: `http://${data.ip}:11434`, ip: data.ip }
        }));
        break;

      case 'STOPPING':
        btnEl.textContent = 'Stopping...';
        btnEl.disabled = true;
        endpointInfoEl.style.display = 'none';
        break;

      default:
        btnEl.disabled = true;
        break;
    }
  }

  function getHeaders() {
    return {
      'Authorization': `Basic ${authToken}`,
      'Content-Type': 'application/json'
    };
  }

  async function checkInitialStatus() {
    if (!apiUrl) return;
    try {
      const res = await fetch(`${apiUrl}/status`, { headers: getHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      const rawState = (data.state || '').toLowerCase();

      if (rawState === 'running' && data.ip) {
        startOllamaPoller(data.ip);
      } else if (rawState === 'pending') {
        transitionTo('STARTING');
        startEc2Poller();
      } else {
        transitionTo('TERMINATED');
      }
    } catch (e) {
      transitionTo('TERMINATED');
    }
  }

  async function startInstance() {
    transitionTo('STARTING');
    try {
      const res = await fetch(`${apiUrl}/start`, { method: 'POST', headers: getHeaders() });
      if (!res.ok) throw new Error('Start failed');
      startEc2Poller();
    } catch (e) {
      transitionTo('TERMINATED');
    }
  }

  async function stopInstance() {
    transitionTo('STOPPING');
    try {
      const res = await fetch(`${apiUrl}/stop`, { method: 'POST', headers: getHeaders() });
      if (!res.ok) throw new Error('Stop failed');
      startTerminationPoller();
    } catch (e) {
      transitionTo('READY', { ip: activeIp });
    }
  }

  function startEc2Poller() {
    clearTimeout(pollInterval);
    pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`${apiUrl}/status`, { headers: getHeaders() });
        const data = await res.json();
        if ((data.state || '').toLowerCase() === 'running' && data.ip) {
          clearInterval(pollInterval);
          startOllamaPoller(data.ip);
        }
      } catch (e) {}
    }, 5000);
  }

  function startOllamaPoller(ip) {
    clearTimeout(pollInterval);
    pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`http://${ip}:11434/`, { method: 'GET', mode: 'cors' });
        if (res.ok || res.status === 200) {
          clearInterval(pollInterval);
          transitionTo('READY', { ip });
        }
      } catch (e) {}
    }, 5000);
  }

  function startTerminationPoller() {
    clearTimeout(pollInterval);
    pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`${apiUrl}/status`, { headers: getHeaders() });
        const data = await res.json();
        if ((data.state || '').toLowerCase() === 'terminated' || !data.state) {
          clearInterval(pollInterval);
          transitionTo('TERMINATED');
        }
      } catch (e) {}
    }, 5000);
  }

  btnEl.addEventListener('click', () => {
    if (state === 'TERMINATED') {
      startInstance();
    } else if (state === 'READY') {
      if (confirm('Terminate instance and tear down Ollama?')) {
        stopInstance();
      }
    }
  });

  // Init
  checkInitialStatus();
})();
