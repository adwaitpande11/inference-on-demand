# Design: Control Plane UI

## Context

See [proposal.md](file:///H:/inference-on-demand/openspec/changes/control-plane-ui/proposal.md) for background and motivation.

`inference-on-demand` runs on AWS using Terraform for persistent infrastructure and boto3 Lambda functions for ephemeral EC2 orchestration. The backend API is exposed via an AWS API Gateway HTTP API with Basic Auth handled by a custom Lambda Authorizer (`api/authorizer.py`). Credentials (`basic-auth-user`, `basic-auth-password`) and domain configuration are stored in AWS SSM Parameter Store.

To preserve architectural modularity (as emphasized in `AGENTS.md`), the control plane UI must be decoupled from the backend compute deployment (`deploy/aws/`). The backend acts purely as a stateless RESTful lifecycle provider, while the UI is an independent client application with its own isolated deployment pipeline.

## Goals / Non-Goals

**Goals:**
- Provide a responsive, single-page web UI (HTML5, Vanilla JS, Bootstrap 5) operating as a standalone control plane dashboard or embeddable widget.
- Ensure the UI deployment is completely decoupled from the backend compute stack (`deploy/aws/`), maintaining separate state and independent lifecycles.
- Enable single-user authentication validating against the existing API Gateway Lambda authorizer and storing session credentials in `sessionStorage`.
- Render the 5-state lifecycle machine (`UNKNOWN`, `TERMINATED`, `STARTING`, `READY`, `STOPPING`) with two-stage polling (`GET /status` then Ollama port 11434).
- Provide a direct, non-streaming prompt playground against Ollama's `/api/generate` and `/api/chat` once the instance is READY.
- Configure CORS on the backend API Gateway (`deploy/aws/main.tf`) and provide an independent minimal-cost hosting configuration under `deploy/aws/ui/` (S3 static website hosting, ~$0.01/month, zero idle compute).

**Non-Goals:**
- Coupling UI infrastructure directly into the backend `deploy/aws/main.tf` state file.
- Multi-user authentication, user registration, role-based access control (RBAC), or AWS Cognito integration.
- Streaming inference responses via Server-Sent Events or WebSockets (explicitly excluded by architecture guidelines).
- Server-side rendering (SSR) or complex frontend build toolchains (Node.js, Next.js, Webpack) that require running servers.
- Storing runtime session or instance state in DynamoDB/SSM.

## Decisions

### Decision 1: Vanilla JavaScript & Bootstrap over Heavy Frontend Frameworks
- **Choice**: Plain vanilla JavaScript (ES modules) with Bootstrap 5 loaded via CDN or static CSS.
- **Rationale**: Keeps the control plane completely buildless and lightweight (< 50 KB total assets). Any developer or operator can open `index.html` locally or deploy directly to S3/Amplify without `npm install` or bundlers.
- **Alternatives considered**:
  - React/Vue/Svelte: Adds build toolchain overhead, dependency maintenance, and larger asset bundles with no tangible benefit for a single-operator control panel.

### Decision 2: Decoupled UI Deployment Root Module (`deploy/aws/ui/`)
- **Choice**: Structure the frontend deployment as an independent Terraform root module under `deploy/aws/ui/` with its own `main.tf`, `variables.tf`, and `outputs.tf`.
- **Rationale**:
  - **Cloud-First Hierarchy**: Preserves the project's cloud-first organization (`deploy/<cloud>/`) while keeping UI hosting (`deploy/aws/ui/`) strictly separate from core backend compute (`deploy/aws/`).
  - **Independent State & Lifecycles**: Running `terraform` in `deploy/aws/ui/` manages only the S3 bucket and static hosting policy. Updating the UI hosting never touches or risks Lambda, IAM, or Security Group state.
  - **Dedicated Variables**: `deploy/aws/ui/variables.tf` declares only what the UI needs (`aws_region`, `bucket_name`, etc.), preventing pollution from backend variables.
- **Alternatives considered**:
  - Embedding S3 hosting into `deploy/aws/main.tf`: Violates separation of concerns and creates tight coupling.
  - `deploy/ui/`: Places UI hosting at root level, breaking the cloud-specific taxonomy (`deploy/<cloud>/`).

### Decision 3: Single-User Authentication via API Gateway Authorizer
- **Choice**: Client-side login form collecting username and password, base64-encoding them into standard HTTP Basic Auth header (`Authorization: Basic <token>`), and validating via an initial `GET /status` call. The token is persisted in `sessionStorage`.
- **Rationale**: Directly reuses the existing `api/authorizer.py` and SSM credentials (`/inference-on-demand/basic-auth-user` and `basic-auth-password`). No additional auth services (such as AWS Cognito) are required, preserving zero-cost operation and single-operator security.
- **Alternatives considered**:
  - Browser native Basic Auth prompt: Clunky UX, difficult to customize, cannot be programmatically cleared for a clean "Logout" flow.
  - AWS Cognito User Pool: Overkill for a single operator; introduces unnecessary AWS configuration and potential monthly billing overhead.

### Decision 4: Backend API Gateway CORS Configuration
- **Choice**: Add `cors_configuration` to `aws_apigatewayv2_api.http_api` in `deploy/aws/main.tf`:
  - `allow_origins`: Configurable via a variable `allowed_ui_origins` (defaulting to allow the S3 website URL and `http://localhost:*` for local testing).
  - `allow_methods`: `GET`, `POST`, `OPTIONS`.
  - `allow_headers`: `Authorization`, `Content-Type`.
- **Rationale**: When the web UI runs on a decoupled S3 website domain, Amplify, or `localhost`, cross-origin browser requests to the API Gateway domain will fail preflight unless CORS is explicitly enabled in the backend.

### Decision 5: Direct Inference & Two-Stage Polling Architecture
- **Choice**: Implement two separate pollers conforming to `architecture/c3-widget-components.md`:
  1. Infrastructure poller: queries `GET /status` every 5 seconds until EC2 reports `running` and provides the dynamic hostname/IP.
  2. Model poller: queries `http://<hostname>:11434/` every 5 seconds until HTTP 200 OK is received.
  3. Inference playground: directly calls `http://<hostname>:11434/api/generate` with `"stream": false`.
- **Rationale**: Ensures the UI never routes inference payloads through API Gateway/Lambda (avoiding Lambda timeout limits and API Gateway costs). Respects the 30-60 second gap between EC2 running and Ollama model availability.

## Risks / Trade-offs

- **[Browser Mixed Content with Ollama Port 11434]** → Modern browsers block insecure HTTP requests (like `http://<subdomain>:11434`) if the hosting web page is loaded over HTTPS (e.g. CloudFront or Amplify).
  *Mitigation*: The decoupled S3 website endpoint in `deploy/aws/ui/` operates over HTTP (`http://<bucket-name>.s3-website-<region>.amazonaws.com`), allowing direct HTTP fetch calls to port 11434 without mixed content errors. For HTTPS environments, operators can configure an SSL reverse proxy (e.g. Caddy) on the EC2 instance or run the UI locally.
- **[Credential Leakage via Client-Side Storage]** → Basic Auth tokens stored in browser storage could theoretically be accessed via XSS.
  *Mitigation*: Use `sessionStorage` (cleared automatically on tab/window close) instead of `localStorage`. The UI contains zero third-party script dependencies other than Bootstrap CDN (with integrity hashes).
- **[Multi-stack Configuration Synchronization]** → Decoupling the UI from backend deployment means the UI needs to know the API Gateway URL.
  *Mitigation*: The UI provides a runtime API URL configuration input (prefilled or configurable via a lightweight `config.js`), or reads from a local config file created after backend deployment.

## Migration Plan

1. In `deploy/aws/`: Add CORS configuration to API Gateway HTTP API in `main.tf` and `variables.tf`. Run `terraform apply` locally.
2. In `ui/` / `widget/`: Implement the control plane frontend files (`index.html`, `app.js`, `style.css`, `config.js`).
3. In `deploy/aws/ui/`: Create a separate Terraform root module for provisioning an S3 static website hosting bucket with its own `variables.tf`.
4. Apply `deploy/aws/ui/` independently and sync web assets to the S3 bucket.
