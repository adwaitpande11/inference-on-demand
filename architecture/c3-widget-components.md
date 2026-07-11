# C3 — Component Diagram: inference-widget.js

```mermaid
graph TD
    HostApp["Host App\nAny browser-based client"]

    subgraph widget["inference-widget.js (Embeddable Widget)"]

        subgraph config["Configuration"]
            Config["Config Reader\nReads data-api-url\ndata-token from script tag"]
        end

        subgraph ui["UI Layer"]
            Button["Button Renderer\nStart / Stop / Starting...\n/ Stopping... states"]
            StatusBadge["Status Badge\nShows current state\nand endpoint URL when ready"]
        end

        subgraph state["State Machine"]
            SM["State Manager\nUNKNOWN → STARTING\n→ READY → STOPPING\n→ TERMINATED"]
        end

        subgraph lifecycle["Lifecycle Controller"]
            StartCtrl["Start Controller\nPOST /start\nBegins polling"]
            StopCtrl["Stop Controller\nPOST /stop\nBegins polling"]
        end

        subgraph polling["Polling Layer"]
            TFPoller["Terraform Run Poller\nGET /status every 5s\nWaits for EC2 running"]
            OllamaPoller["Ollama Health Poller\nGET :11434 every 5s\nWaits for 200 OK"]
        end

        subgraph events["Event Bus"]
            EventEmitter["Custom Event Emitter\nFires ollamaReady\nFires ollamaOffline"]
        end

    end

    LifecycleAPI["Lifecycle API\nAPI Gateway + Lambda"]
    OllamaEndpoint["Ollama\nollama.yourdomain.com:11434"]

    HostApp -->|"script tag\ndata-api-url, data-token"| Config
    Config -->|"Initialise with\napi url + auth token"| SM
    SM -->|"Render button\nfor current state"| Button
    SM -->|"Update badge"| StatusBadge
    Button -->|"Click: Start"| StartCtrl
    Button -->|"Click: Stop"| StopCtrl
    StartCtrl -->|"POST /start\nBasic Auth"| LifecycleAPI
    StartCtrl -->|"Transition to STARTING\nbegin polling"| SM
    StopCtrl -->|"POST /stop\nBasic Auth"| LifecycleAPI
    StopCtrl -->|"Transition to STOPPING\nbegin polling"| SM
    SM -->|"STARTING: activate"| TFPoller
    TFPoller -->|"GET /status"| LifecycleAPI
    TFPoller -->|"EC2 running:\nactivate Ollama poller"| OllamaPoller
    OllamaPoller -->|"GET / (health check)"| OllamaEndpoint
    OllamaPoller -->|"200 OK:\ntransition to READY"| SM
    SM -->|"READY: fire event\nwith endpoint URL"| EventEmitter
    SM -->|"TERMINATED: fire event"| EventEmitter
    EventEmitter -->|"ollamaReady / ollamaOffline\nCustomEvent on window"| HostApp
    HostApp -->|"Direct inference calls\nafter ollamaReady"| OllamaEndpoint
```

## Component responsibilities

| Component | Responsibility |
|---|---|
| Config Reader | Reads `data-api-url` and `data-token` from the `<script>` tag attributes at initialisation |
| State Manager | Single source of truth for widget state — all transitions go through here |
| Button Renderer | Renders the correct button label and enabled/disabled state for each state machine state |
| Status Badge | Displays current state and, when READY, the active endpoint URL |
| Start Controller | Calls `POST /start`, handles errors, instructs State Manager to transition to STARTING |
| Stop Controller | Calls `POST /stop`, handles errors, instructs State Manager to transition to STOPPING |
| Terraform Run Poller | Polls `GET /status` every 5s while STARTING — waits for EC2 to reach `running` state |
| Ollama Health Poller | Polls `GET :11434` every 5s after EC2 is running — waits for Ollama to respond 200 OK |
| Custom Event Emitter | Fires `ollamaReady` (with endpoint URL) and `ollamaOffline` on `window` for host app to consume |

## State machine transitions

| From | Event | To |
|---|---|---|
| UNKNOWN | Widget initialises, `/status` returns no active run | TERMINATED |
| UNKNOWN | Widget initialises, `/status` returns active run + EC2 running | READY |
| TERMINATED | User clicks Start | STARTING |
| STARTING | Ollama returns 200 OK | READY |
| READY | User clicks Stop | STOPPING |
| STOPPING | Terraform destroy completes | TERMINATED |

## Notes

- Two-stage polling is intentional: Terraform Run Poller and Ollama Health Poller are separate concerns — EC2 `running` in AWS does not mean Ollama is ready to serve
- The widget fires events on `window` so host apps need zero knowledge of the widget internals — they only listen for `ollamaReady`
- All API calls include `Authorization: Basic <token>` derived from `data-token` attribute
- The widget is self-contained — no framework dependencies, no build step required
EOF