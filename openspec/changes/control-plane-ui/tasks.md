# Tasks

## 1. Backend API Gateway CORS Configuration

- [x] 1.1 Add `allowed_ui_origins` variable in `deploy/aws/variables.tf` and configure CORS on API Gateway HTTP API in `deploy/aws/main.tf` to permit cross-origin UI requests, verifying syntax with `terraform validate`
- [x] 1.2 Verify `deploy/aws/` remains strictly focused on backend compute orchestration without frontend hosting resources

## 2. Decoupled UI Hosting Infrastructure (`deploy/aws/ui/`)

- [x] 2.1 Create independent Terraform root module in `deploy/aws/ui/` (`main.tf`, `variables.tf`, `outputs.tf`) for S3 static website hosting and bucket policy, verifying with `terraform validate`
- [x] 2.2 Add asset upload and deployment documentation to `deploy/aws/ui/README.md` for independent frontend lifecycle management

## 3. Authentication & Client-Side State Management

- [x] 3.1 Implement credential entry, configurable `API_BASE_URL`, and HTTP Basic Auth encoder in `widget/app.js` and verify credentials persist in `sessionStorage`
- [x] 3.2 Implement authentication verification against API Gateway `GET /status` endpoint and verify 401/403 handling displays login failure alert
- [x] 3.3 Implement user logout flow that clears credentials from `sessionStorage` and resets lifecycle state to login view

## 4. Control Plane UI & Lifecycle Operations

- [x] 4.1 Build responsive HTML layout in `widget/index.html` and Bootstrap styling featuring API endpoint configuration, login view, status badges, instance controls, and endpoint monitors
- [x] 4.2 Implement state machine manager in `widget/app.js` handling transitions across UNKNOWN, TERMINATED, STARTING, READY, and STOPPING states
- [x] 4.3 Implement Start and Stop action controllers calling `POST /start` and `POST /stop` with confirmation modals and error handling
- [x] 4.4 Implement two-stage polling mechanism (infrastructure polling `GET /status` every 5s until EC2 is `running`, then Ollama poller checking `:11434` until 200 OK)

## 5. Direct Non-Streaming Inference Playground

- [x] 5.1 Build inference testing panel in `widget/index.html` with prompt textarea, model selection, latency display, and output card
- [x] 5.2 Implement direct non-streaming client request to `http://<endpoint>:11434/api/generate` with `"stream": false` and verify response rendering without proxying through Lambda

## 6. Embeddable Widget & Documentation

- [x] 6.1 Package reusable embeddable script in `widget/inference-widget.js` and demo host in `widget/demo.html`
- [x] 6.2 Update `README.md` with instructions for running the control plane UI locally or deploying it independently to AWS S3 via `deploy/aws/ui/`

## 7. Pending Verification & Follow-up

> **NOTE FOR NEXT SESSION**:
> - Decoupled UI infrastructure (`deploy/aws/ui/`) is implemented and validated locally, but **NOT yet deployed to actual S3**.
> - End-to-end smoke test on **actual S3 website URL is PENDING**.
> - Do not archive change `control-plane-ui` until actual S3 deployment and testing are complete.

- [ ] 7.1 Deploy `deploy/aws/ui/` to actual AWS S3 via `terraform apply`
- [ ] 7.2 Sync `widget/` static assets to the S3 bucket using AWS CLI
- [ ] 7.3 Execute end-to-end test against the live S3 website URL and verify CORS / Ollama connectivity

