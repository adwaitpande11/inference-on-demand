# Control Plane UI Specification

## Purpose

Provides a lightweight, secure browser-based control plane web interface and decoupled minimal-cost AWS static hosting to manage ephemeral EC2 inference lifecycle and execute direct Ollama inference.

## Requirements

### Requirement: Single-User Authentication
The web control plane SHALL provide a client-side authentication gateway that requires the operator to provide credentials matching the system's authorized credentials before accessing control functions.

#### Scenario: Successful authentication
- **WHEN** user enters valid username and password and submits the login form
- **THEN** the UI tests credentials against the configured backend `/status` endpoint, stores the Basic Auth token in `sessionStorage`, and reveals the control plane dashboard

#### Scenario: Authentication failure with invalid credentials
- **WHEN** user enters incorrect credentials
- **THEN** the UI receives HTTP 401/403 from the API Gateway authorizer, displays an authentication error message, and denies access to control operations

#### Scenario: Session persistence across reloads
- **WHEN** authenticated user refreshes the browser page
- **THEN** the UI restores the credentials from `sessionStorage` and validates current session against `GET /status` without prompting for re-login

#### Scenario: User explicit logout
- **WHEN** user clicks the "Logout" action
- **THEN** the UI removes stored credentials from `sessionStorage`, resets all state timers, and displays the login screen

### Requirement: Compute Lifecycle Operations
The control plane SHALL provide visual controls allowing the authorized user to launch a fresh inference compute instance or terminate an active instance.

#### Scenario: Launching an instance from terminated state
- **WHEN** user clicks the "Start Instance" button while in TERMINATED state
- **THEN** the UI issues `POST /start` with the stored Authorization header, disables the start button, and transitions the state machine to STARTING

#### Scenario: Terminating an instance from ready state
- **WHEN** user clicks the "Stop Instance" button and confirms the action
- **THEN** the UI issues `POST /stop` with the stored Authorization header, disables control buttons, and transitions the state machine to STOPPING

#### Scenario: Handling lifecycle launch error
- **WHEN** `POST /start` fails or returns a non-200 HTTP status code
- **THEN** the UI displays an error alert with the failure details and reverts state to TERMINATED

### Requirement: Two-Stage Health and State Polling
The control plane SHALL execute two distinct polling phases to monitor compute provisioning and Ollama model readiness independently.

#### Scenario: EC2 infrastructure provisioning poller
- **WHEN** the UI enters the STARTING state
- **THEN** the UI polls `GET /status` every 5 seconds until the compute state reports `running` with an active DNS/IP endpoint

#### Scenario: Ollama service readiness poller
- **WHEN** EC2 reports `running`
- **THEN** the UI initiates HTTP GET polling directly to `http://<domain>:11434/` every 5 seconds until Ollama returns HTTP 200 OK, at which point the UI transitions to READY

#### Scenario: Compute termination polling
- **WHEN** the UI enters the STOPPING state
- **THEN** the UI polls `GET /status` every 5 seconds until the compute state reports `terminated`, at which point the UI transitions to TERMINATED

### Requirement: Direct Non-Streaming Inference Playground
The control plane SHALL provide an interactive prompt testing interface that communicates directly with the Ollama endpoint without routing inference payload through Lambda.

#### Scenario: Single-turn text generation
- **WHEN** the system is in READY state and user submits a prompt with a selected model
- **THEN** the UI sends a direct POST request to `http://<domain>:11434/api/generate` with `"stream": false`, displays the complete response text upon completion, and presents response duration metrics

#### Scenario: Error during inference call
- **WHEN** an inference call to Ollama fails or times out
- **THEN** the UI displays a descriptive error message indicating the endpoint failure without altering the control plane lifecycle state

### Requirement: Decoupled UI Architecture and Minimal-Cost Hosting
The control plane UI SHALL operate as an independent frontend decoupled from backend compute infrastructure deployment, communicating with the backend via REST endpoints with CORS preflight support.

#### Scenario: Configurable backend endpoint targeting
- **WHEN** the control plane UI initializes
- **THEN** it reads the target backend API Gateway URL from its configuration without hardcoding backend infrastructure specifics

#### Scenario: Cross-Origin API requests
- **WHEN** the browser-hosted control plane issues requests to the API Gateway HTTP API
- **THEN** API Gateway returns CORS preflight headers allowing the request method, headers (`Authorization`, `Content-Type`), and the UI origin

#### Scenario: Independent static web hosting in deploy/aws/ui/
- **WHEN** the UI is deployed via its independent hosting deployment (`deploy/aws/ui/`)
- **THEN** static assets (HTML, JS, CSS) are served from an isolated static hosting bucket with zero idle compute cost, without affecting or depending on the backend Terraform state
