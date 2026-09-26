/**
 * Inference on Demand — Control Plane Application
 * Real API Gateway & Real Compute Lifecycle Management
 */

// State Machine States
export const STATES = {
  UNKNOWN: 'UNKNOWN',
  TERMINATED: 'TERMINATED',
  STARTING: 'STARTING',
  READY: 'READY',
  STOPPING: 'STOPPING'
};

class ControlPlaneApp {
  constructor() {
    this.state = STATES.UNKNOWN;
    this.apiUrl = '';
    this.authToken = '';
    this.currentIp = '';
    this.pollTimer = null;
    this.pollPhase = null; // 'ec2' or 'ollama'

    this.initElements();
    this.bindEvents();
    this.checkExistingSession();
  }

  initElements() {
    // Views
    this.loginView = document.getElementById('login-view');
    this.dashboardView = document.getElementById('dashboard-view');
    this.navUserActions = document.getElementById('nav-user-actions');
    this.navUserLabel = document.getElementById('nav-user-label');

    // Login Form
    this.loginForm = document.getElementById('login-form');
    this.apiUrlInput = document.getElementById('api-url-input');
    this.usernameInput = document.getElementById('username-input');
    this.passwordInput = document.getElementById('password-input');
    this.loginAlert = document.getElementById('login-alert');
    this.loginSpinner = document.getElementById('login-spinner');
    this.btnLogin = document.getElementById('btn-login');

    // Dashboard Elements
    this.displayApiUrl = document.getElementById('display-api-url');
    this.btnEditApi = document.getElementById('btn-edit-api');
    this.statusBadge = document.getElementById('status-badge');
    this.statusText = document.getElementById('status-text');
    this.displayIp = document.getElementById('display-ip');
    this.displayEndpoint = document.getElementById('display-endpoint');
    this.pollingBanner = document.getElementById('polling-banner');
    this.pollingMessage = document.getElementById('polling-message');
    this.activityLog = document.getElementById('activity-log');

    // Controls
    this.btnStart = document.getElementById('btn-start');
    this.btnStop = document.getElementById('btn-stop');
    this.btnRefresh = document.getElementById('btn-refresh');
    this.btnLogout = document.getElementById('btn-logout');
    this.btnConfirmStop = document.getElementById('btn-confirm-stop');

    // Inference Elements
    this.inferenceForm = document.getElementById('inference-form');
    this.modelInput = document.getElementById('model-input');
    this.promptInput = document.getElementById('prompt-input');
    this.btnRunInference = document.getElementById('btn-run-inference');
    this.inferenceSpinner = document.getElementById('inference-spinner');
    this.inferenceLatency = document.getElementById('inference-latency');
    this.inferenceOutput = document.getElementById('inference-output');
    this.inferenceStatusBadge = document.getElementById('inference-status-badge');

    // Modal
    this.stopModalElement = document.getElementById('stopConfirmModal');
    this.stopModal = (this.stopModalElement && window.bootstrap) ? new bootstrap.Modal(this.stopModalElement) : null;
  }

  bindEvents() {
    this.loginForm?.addEventListener('submit', (e) => this.handleLogin(e));
    this.btnLogout?.addEventListener('click', () => this.handleLogout());
    this.btnEditApi?.addEventListener('click', () => this.handleEditApi());

    this.btnStart?.addEventListener('click', () => this.handleStart());
    this.btnStop?.addEventListener('click', () => this.stopModal?.show());
    this.btnConfirmStop?.addEventListener('click', () => {
      this.stopModal?.hide();
      this.handleStop();
    });
    this.btnRefresh?.addEventListener('click', () => this.fetchStatus());

    this.inferenceForm?.addEventListener('submit', (e) => this.handleInference(e));
  }

  checkExistingSession() {
    const savedApiUrl = localStorage.getItem('iod_api_url') || '';
    const savedToken = sessionStorage.getItem('iod_auth_token') || '';

    if (savedApiUrl) {
      this.apiUrlInput.value = savedApiUrl;
      this.apiUrl = savedApiUrl;
    }

    if (savedApiUrl && savedToken) {
      this.authToken = savedToken;
      this.showDashboard();
      this.log('Restoring previous authenticated session...', 'info');
      this.fetchStatus();
    } else {
      this.showLogin();
    }
  }

  async handleLogin(e) {
    e.preventDefault();
    this.loginAlert.classList.add('d-none');
    this.loginAlert.innerHTML = '';
    this.loginSpinner.classList.remove('d-none');
    this.btnLogin.disabled = true;

    const url = this.apiUrlInput.value.trim().replace(/\/+$/, '');
    const user = this.usernameInput.value.trim();
    const pass = this.passwordInput.value.trim();
    const token = btoa(`${user}:${pass}`);

    try {
      // Connect to real AWS API Gateway /status endpoint
      const response = await fetch(`${url}/status`, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.status === 401 || response.status === 403) {
        throw new Error('Authentication rejected (401/403). Please verify username and password match AWS SSM parameters /inference-on-demand/basic-auth-user & basic-auth-password.');
      }

      if (!response.ok) {
        throw new Error(`API Gateway returned HTTP ${response.status} (${response.statusText})`);
      }

      const data = await response.json();

      this.apiUrl = url;
      this.authToken = token;
      localStorage.setItem('iod_api_url', url);
      sessionStorage.setItem('iod_auth_token', token);

      this.showDashboard();
      this.navUserLabel.textContent = user;
      this.log(`Successfully authenticated as operator "${user}". Connected to ${url}`, 'success');
      this.processStatusResponse(data);
    } catch (err) {
      const isFailedFetch = err.message.includes('Failed to fetch') || err.name === 'TypeError';
      let errorMsg = err.message;

      if (isFailedFetch) {
        errorMsg = `<strong>Connection / CORS Error:</strong> Unable to reach <code>${url}/status</code>.<br><br>
        <strong>Troubleshooting:</strong>
        <ul class="mb-1 ps-3">
          <li>Check that the API Gateway URL is correct and deployed.</li>
          <li><strong>CORS Preflight:</strong> If accessing from <code>localhost</code>, your API Gateway must have CORS enabled for preflight <code>OPTIONS</code> requests.</li>
          <li>Test with curl from your terminal: <br><code>curl -i -H "Authorization: Basic ${token}" ${url}/status</code></li>
        </ul>`;
      }

      this.loginAlert.innerHTML = errorMsg;
      this.loginAlert.classList.remove('d-none');
    } finally {
      this.loginSpinner.classList.add('d-none');
      this.btnLogin.disabled = false;
    }
  }

  handleLogout() {
    this.stopPolling();
    this.authToken = '';
    sessionStorage.removeItem('iod_auth_token');
    this.transitionTo(STATES.UNKNOWN);
    this.showLogin();
  }

  handleEditApi() {
    this.stopPolling();
    this.showLogin();
  }

  showLogin() {
    this.loginView.classList.remove('d-none');
    this.dashboardView.classList.add('d-none');
    this.navUserActions.classList.add('d-none');
  }

  showDashboard() {
    this.loginView.classList.add('d-none');
    this.dashboardView.classList.remove('d-none');
    this.navUserActions.classList.remove('d-none');
    this.displayApiUrl.textContent = this.apiUrl;
  }

  transitionTo(newState, data = {}) {
    this.state = newState;
    this.statusText.textContent = newState;

    this.statusBadge.className = 'status-pill';
    this.statusBadge.classList.add(`status-${newState.toLowerCase()}`);

    switch (newState) {
      case STATES.TERMINATED:
        this.btnStart.disabled = false;
        this.btnStop.disabled = true;
        this.pollingBanner.classList.add('d-none');
        this.displayIp.textContent = 'Not provisioned';
        this.displayEndpoint.textContent = 'Offline';
        this.displayEndpoint.classList.add('text-muted');
        this.btnRunInference.disabled = true;
        this.inferenceStatusBadge.textContent = 'Compute Offline';
        this.inferenceStatusBadge.className = 'badge bg-secondary';
        break;

      case STATES.STARTING:
        this.btnStart.disabled = true;
        this.btnStop.disabled = true;
        this.pollingBanner.classList.remove('d-none');
        this.btnRunInference.disabled = true;
        this.inferenceStatusBadge.textContent = 'Starting Up...';
        this.inferenceStatusBadge.className = 'badge bg-warning text-dark';
        break;

      case STATES.READY:
        this.btnStart.disabled = true;
        this.btnStop.disabled = false;
        this.pollingBanner.classList.add('d-none');
        if (data.ip) {
          this.currentIp = data.ip;
          this.displayIp.textContent = data.ip;
          this.displayEndpoint.textContent = `http://${data.ip}:11434`;
          this.displayEndpoint.classList.remove('text-muted');
        }
        this.btnRunInference.disabled = false;
        this.inferenceStatusBadge.textContent = 'Ready for Inference';
        this.inferenceStatusBadge.className = 'badge bg-success';
        break;

      case STATES.STOPPING:
        this.btnStart.disabled = true;
        this.btnStop.disabled = true;
        this.pollingBanner.classList.remove('d-none');
        this.pollingMessage.textContent = 'Terminating EC2 instance and deleting DNS record...';
        this.btnRunInference.disabled = true;
        this.inferenceStatusBadge.textContent = 'Tearing Down';
        this.inferenceStatusBadge.className = 'badge bg-danger';
        break;

      case STATES.UNKNOWN:
      default:
        this.btnStart.disabled = true;
        this.btnStop.disabled = true;
        this.btnRunInference.disabled = true;
        this.pollingBanner.classList.add('d-none');
        break;
    }
  }

  async fetchStatus() {
    try {
      const res = await fetch(`${this.apiUrl}/status`, {
        headers: { 'Authorization': `Basic ${this.authToken}` }
      });
      if (res.status === 401 || res.status === 403) {
        this.log('Authentication expired or unauthorized.', 'error');
        this.handleLogout();
        return;
      }
      const data = await res.json();
      this.processStatusResponse(data);
    } catch (err) {
      this.log(`Error querying status: ${err.message}`, 'error');
    }
  }

  processStatusResponse(data) {
    const rawState = (data.state || '').toLowerCase();
    const ip = data.ip || '';

    this.log(`EC2 State: [${rawState || 'none'}] | IP: ${ip || 'none'}`, 'info');

    if (rawState === 'running') {
      this.currentIp = ip;
      this.displayIp.textContent = ip;
      this.displayEndpoint.textContent = `http://${ip}:11434`;
      this.displayEndpoint.classList.remove('text-muted');

      if (this.state === STATES.STARTING || this.state !== STATES.READY) {
        this.startOllamaPoller(ip);
      }
    } else if (rawState === 'pending') {
      this.transitionTo(STATES.STARTING);
      this.startEc2Poller();
    } else if (rawState === 'shutting-down' || rawState === 'stopping') {
      this.transitionTo(STATES.STOPPING);
      this.startTerminationPoller();
    } else {
      this.stopPolling();
      this.transitionTo(STATES.TERMINATED);
    }
  }

  async handleStart() {
    this.transitionTo(STATES.STARTING);
    this.log('Requesting instance launch via POST /start...', 'info');

    try {
      const res = await fetch(`${this.apiUrl}/start`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${this.authToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!res.ok) {
        throw new Error(`POST /start failed with HTTP ${res.status}`);
      }

      const data = await res.json();
      this.log(`Instance launch triggered. Instance ID: ${data.instance_id || 'N/A'}`, 'success');
      this.startEc2Poller();
    } catch (err) {
      this.log(`Start error: ${err.message}`, 'error');
      alert(`Launch failed: ${err.message}`);
      this.transitionTo(STATES.TERMINATED);
    }
  }

  async handleStop() {
    this.transitionTo(STATES.STOPPING);
    this.log('Requesting instance teardown via POST /stop...', 'warn');

    try {
      const res = await fetch(`${this.apiUrl}/stop`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${this.authToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!res.ok) {
        throw new Error(`POST /stop failed with HTTP ${res.status}`);
      }

      this.log('Termination request accepted. Waiting for EC2 termination...', 'info');
      this.startTerminationPoller();
    } catch (err) {
      this.log(`Stop error: ${err.message}`, 'error');
      alert(`Stop failed: ${err.message}`);
      this.transitionTo(STATES.READY, { ip: this.currentIp });
    }
  }

  // --- Real Polling Engine ---

  startEc2Poller() {
    this.stopPolling();
    this.pollPhase = 'ec2';
    this.pollingMessage.textContent = 'Stage 1/2: Waiting for EC2 instance to reach running state (5s interval)...';

    this.pollTimer = setInterval(async () => {
      try {
        const res = await fetch(`${this.apiUrl}/status`, {
          headers: { 'Authorization': `Basic ${this.authToken}` }
        });
        const data = await res.json();
        const rawState = (data.state || '').toLowerCase();

        if (rawState === 'running' && data.ip) {
          this.log(`EC2 instance is running at IP ${data.ip}.`, 'success');
          this.startOllamaPoller(data.ip);
        } else {
          this.log(`EC2 state: ${rawState || 'pending'}... waiting.`, 'info');
        }
      } catch (err) {
        this.log(`Polling status error: ${err.message}`, 'warn');
      }
    }, 5000);
  }

  startOllamaPoller(ip) {
    this.stopPolling();
    this.pollPhase = 'ollama';
    this.currentIp = ip;
    this.pollingMessage.textContent = `Stage 2/2: Polling Ollama on http://${ip}:11434/ (5s interval)...`;

    this.pollTimer = setInterval(async () => {
      try {
        const res = await fetch(`http://${ip}:11434/`, { method: 'GET', mode: 'cors' });
        if (res.ok || res.status === 200) {
          this.stopPolling();
          this.log('Ollama model server is ready and responding!', 'success');
          this.transitionTo(STATES.READY, { ip });
          this.fetchInstalledModels(ip);
        } else {
          this.log(`Ollama responded with HTTP ${res.status}. Waiting for model server ready...`, 'info');
        }
      } catch (err) {
        this.log(`Ollama health check waiting: ${err.message}`, 'info');
      }
    }, 5000);
  }

  async fetchInstalledModels(ip) {
    try {
      const res = await fetch(`http://${ip}:11434/api/tags`);
      if (res.ok) {
        const data = await res.json();
        const models = (data.models || []).map(m => m.name);
        if (models.length > 0) {
          this.log(`Discovered installed models: ${models.join(', ')}`, 'info');
          if (this.modelInput) {
            this.modelInput.value = models[0];
          }
        }
      }
    } catch (e) {
      this.log(`Could not query model tags: ${e.message}`, 'warn');
    }
  }

  startTerminationPoller() {
    this.stopPolling();
    this.pollPhase = 'termination';

    this.pollTimer = setInterval(async () => {
      try {
        const res = await fetch(`${this.apiUrl}/status`, {
          headers: { 'Authorization': `Basic ${this.authToken}` }
        });
        const data = await res.json();
        const rawState = (data.state || '').toLowerCase();

        if (rawState === 'terminated' || rawState === '') {
          this.stopPolling();
          this.log('Instance terminated and DNS record deleted.', 'success');
          this.transitionTo(STATES.TERMINATED);
        } else {
          this.log(`EC2 state: ${rawState}... waiting for termination.`, 'info');
        }
      } catch (err) {
        this.log(`Termination poll error: ${err.message}`, 'warn');
      }
    }, 5000);
  }

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.pollPhase = null;
  }

  // --- Direct Real Non-Streaming Inference ---

  async handleInference(e) {
    e.preventDefault();
    if (this.state !== STATES.READY || !this.currentIp) {
      alert('Instance is not in READY state.');
      return;
    }

    const model = this.modelInput.value.trim();
    const prompt = this.promptInput.value.trim();

    this.btnRunInference.disabled = true;
    this.inferenceSpinner.classList.remove('d-none');
    this.inferenceLatency.textContent = 'Generating...';
    this.inferenceOutput.textContent = `Sending request directly to Ollama at http://${this.currentIp}:11434...`;

    const startTime = performance.now();
    const endpoint = `http://${this.currentIp}:11434/api/generate`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model,
          prompt: prompt,
          stream: false
        })
      });

      const elapsed = Math.round(performance.now() - startTime);

      if (!response.ok) {
        let errorDetail = response.statusText;
        try {
          const errData = await response.json();
          if (errData.error) errorDetail = errData.error;
        } catch (_) {}
        throw new Error(`Ollama returned HTTP ${response.status}: ${errorDetail}`);
      }

      const data = await response.json();
      this.inferenceLatency.textContent = `Completed in ${elapsed} ms`;
      this.inferenceOutput.textContent = data.response || JSON.stringify(data, null, 2);
      this.log(`Inference successful (${elapsed} ms, ${data.eval_count || 0} tokens).`, 'success');
    } catch (err) {
      this.inferenceLatency.textContent = 'Failed';
      this.inferenceOutput.textContent = `Error calling Ollama endpoint:\n${err.message}\n\nNote: In modern browsers, calls from an HTTPS origin to plain HTTP (${endpoint}) are blocked as mixed content. When running the UI locally on http://localhost, direct HTTP calls to port 11434 are allowed.`;
      this.log(`Inference error: ${err.message}`, 'error');
    } finally {
      this.btnRunInference.disabled = false;
      this.inferenceSpinner.classList.add('d-none');
    }
  }

  log(message, type = 'info') {
    const time = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.className = `log-line ${type}`;
    line.textContent = `[${time}] ${message}`;
    this.activityLog.appendChild(line);
    this.activityLog.scrollTop = this.activityLog.scrollHeight;
  }
}

// Bootstrap on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new ControlPlaneApp();
});
