# Proposal: Control Plane UI

## Why

`inference-on-demand` enables ephemeral, cost-efficient LLM inference by spinning up EC2 compute on demand and terminating it after use. Currently, controlling instance lifecycle requires direct API Gateway calls (e.g., via curl or Postman) or embedding an unhosted widget into an external site. 

Operators need a dedicated, lightweight, single-user control plane web interface that can be hosted on AWS at near-zero idle cost, secured with an authentication mechanism so only the authorized operator can access and control compute resources. 

To maintain architectural modularity, the control plane UI must be strictly decoupled from the core backend compute orchestration stack (`deploy/aws/`), allowing the frontend and backend to evolve, deploy, and scale independently.

## What Changes

- **Decoupled Control Plane Web Application**: Implement a lightweight, single-page web UI (HTML, vanilla JavaScript, CSS/Bootstrap) that acts as the primary control plane for `inference-on-demand`, independent of any specific backend deployment.
- **Single-User Authentication**: Integrate single-user login (HTTP Basic Auth matching SSM credentials via the existing Lambda authorizer) with secure browser session storage and logout functionality.
- **Compute Lifecycle & Health Operations**: Provide interactive controls to start instances (`POST /start`), stop instances (`POST /stop`), inspect current EC2 state (`GET /status`), and execute two-stage health checks against Ollama (`:11434`).
- **Interactive Inference Playground**: Include a built-in test console to execute non-streaming generation (`/api/generate` or `/api/chat`) directly against the provisioned Ollama endpoint once reachable.
- **Backend API Gateway CORS**: Enable standard CORS preflight on API Gateway in `deploy/aws/main.tf` to accept authenticated cross-origin calls from any authorized UI origin (S3, Amplify, or localhost).
- **Independent AWS UI Hosting (`deploy/aws/ui/`)**: Provide a separate, isolated Terraform root module under `deploy/aws/ui/` for hosting static web assets on AWS S3 with static website hosting (or CloudFront/Amplify) with zero idle compute cost ($0.00-$0.02/month storage only), completely decoupled from `deploy/aws/` core backend state.

## Capabilities

### New Capabilities
- `control-plane-ui`: Single-user browser-based control plane interface and decoupled minimal-cost hosting configuration for managing ephemeral inference lifecycle and executing direct model inference.

### Modified Capabilities
*(None - this project has no prior specs)*

## Impact

- **Frontend**: Adds static web assets under `widget/` or `ui/` (`index.html`, `app.js`, `styles.css` / Bootstrap) configured to connect to any backend API endpoint via dynamic or stored `API_BASE_URL`.
- **Backend Terraform (`deploy/aws/`)**: Adds CORS configuration on API Gateway HTTP API to permit cross-origin requests from the UI origin. Core compute, Lambda, and IAM definitions remain strictly modular and untouched by UI concerns.
- **UI Hosting Infrastructure (`deploy/aws/ui/`)**: Adds an independent Terraform root module for provisioning the UI's static hosting (S3 static website bucket, bucket policy, outputs) with its own state and separate `variables.tf`.
- **Security**: Ensures all control operations require valid single-user Basic Auth credentials, preventing unauthorized instance launches or terminations.
