# Computer Networks Special Experiment: Algorithm Visualizer

[中文文档 (Chinese)](./README-CN.md)

This README is reorganized following the Experiment-7 report template (name, principles, objectives, implementation, testing, conclusion), with a focused postmortem on one complete frontend-backend connectivity debugging process.

## Demo Videos

> GitHub may not always provide stable inline playback for repository `.mov` files.  
> Click the preview card to open the original video.

### Heap Building Demo

[![Heap Building Demo](./static-videos/previews/Heap_Building.preview.png)](./static-videos/Heap_Building.mov)

### Quick Sort Demo

[![Quick Sort Demo](./static-videos/previews/Quick_Sort.preview.png)](./static-videos/Quick_Sort.mov)

## 1. Experiment Name

Algorithm Visualization Demo System (Experiment 7: Socket / Network Programming)

## 2. Principles

The system uses a browser-server architecture with two communication planes:

- HTTP plane: task submission and health check (`/api/visualize`, `/api/health`).
- WebSocket plane: real-time control and step streaming (`/ws`).

Key principles:

1. A listening TCP port (L4) does not guarantee complete application routing (L7).
2. WebSocket handshake must strictly follow RFC 6455 (`Sec-WebSocket-Accept` derivation).
3. TCP is a byte stream; request body must be read to full `Content-Length` before JSON parsing.

## 3. Objectives

- Build a complete frontend-backend algorithm visualization system.
- Practice HTTP + WebSocket collaboration on one service.
- Learn systematic debugging for cloud deployment connectivity issues.

## 4. Scope

### 4.1 Basic Features

- Required algorithm: heap building visualization.
- Input integer arrays and submit tasks.
- Start / pause / resume / step / reset controls.

### 4.2 Advanced Features

- Optional algorithm: quick sort visualization.
- Local mode and integration mode.
- Session isolation using `sessionId`.

## 5. Implementation

### 5.1 Protocol and Architecture

- Transport: HTTP + WebSocket over TCP.
- Deployment: single port `8080` serving static files + APIs + WS.
- Backend threading model: per-connection handling threads with shared session map.

### 5.2 Key Files

- Backend: `backend/app.py`
- Frontend: `src/index.html`, `src/main.js`, `src/socket.js`, `src/visualizer.js`, `src/mockRunner.js`

## 6. Debugging Timeline: Frontend/Backend Not Connected

### Issue A: `/api/health` works but `/` returns 404

Root cause:

- backend had no static-route handling for `/` and frontend assets.

Fix:

- add static hosting routes (`/`, `/index.html`, `/main.js`, etc.).

### Issue B: UI appears but integration interactions fail

Root cause:

- frontend runtime compatibility issue during initialization (session-id generation path).

Fix:

- add robust session-id fallback logic and hard-refresh browser cache.

### Issue C: WebSocket keeps reconnecting

Root cause:

- handshake/GUID mismatch and control-frame handling instability.

Fix:

- align handshake logic to RFC 6455 and stabilize ping/pong handling.

### Issue D: "Invalid JSON" on task submission

Root cause:

- HTTP body not fully read before `json.loads`, due to TCP fragmentation.

Fix:

- read body until `Content-Length` is fully satisfied, then parse JSON.

## 7. Final Runbook

```bash
cd backend
python3 -m pip install -r requirements.txt
python3 app.py
# open: http://<host>:8080/
```

Quick verification:

```bash
curl -s http://127.0.0.1:8080/api/health
curl -s -X POST http://127.0.0.1:8080/api/visualize \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"demo-1","algorithm":"heap_build","input":[7,2,9,1,5,8,3,6,4]}' 
```

## 8. Conclusion

The project achieved stable cloud deployment and integration by resolving routing, handshake, runtime, and payload-boundary issues in order. The key takeaway is layered debugging: reachability → routing → protocol correctness → payload completeness.

## License

This project is licensed under the [MIT License](./LICENSE).
