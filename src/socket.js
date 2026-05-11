/**
 * WebSocket 通信模块
 *
 * 前后端协议约定（建议）：
 * 1) 客户端 -> 服务端
 *   {"type":"start","sessionId":"...","algorithm":"heap_build","speed":"normal"}
 *   {"type":"pause","sessionId":"..."}
 *   {"type":"resume","sessionId":"..."}
 *   {"type":"step","sessionId":"..."}      // 单步执行（可选）
 *   {"type":"reset","sessionId":"..."}
 *   {"type":"ping","sessionId":"..."}
 *
 * 2) 服务端 -> 客户端
 *   {"type":"connected","sessionId":"..."}
 *   {"type":"step","payload": StepPayload}
 *   {"type":"done","message":"演示完成"}
 *   {"type":"error","message":"..."}
 *   {"type":"pong"}
 *
 * StepPayload 推荐结构：
 * {
 *   "id": 12,
 *   "algorithm": "heap_build",
 *   "description": "比较节点 2 与其子节点 5",
 *   "array": [7,2,9,1,5,8,3,6,4],
 *   "active": 2,
 *   "compare": [5],
 *   "swap": [2,5],
 *   "doneRange": [6,8]
 * }
 */

export class SocketClient {
  constructor(url, hooks = {}) {
    this.url = url;
    this.hooks = hooks;
    this.ws = null;
    this.reconnectTimer = null;
    this.manualClose = false;
    this.pingTimer = null;
  }

  connect() {
    this.manualClose = false;
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.hooks.onOpen?.();
      this.startPing();
    };

    this.ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        this.hooks.onMessage?.(msg);
      } catch {
        this.hooks.onRawMessage?.(ev.data);
      }
    };

    this.ws.onerror = () => {
      this.hooks.onError?.('WebSocket 连接发生错误');
    };

    this.ws.onclose = () => {
      this.stopPing();
      this.hooks.onClose?.();
      if (!this.manualClose) {
        this.scheduleReconnect();
      }
    };
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.hooks.onReconnect?.();
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 1500);
  }

  send(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(obj));
    return true;
  }

  close() {
    this.manualClose = true;
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
  }

  startPing() {
    this.stopPing();
    this.pingTimer = window.setInterval(() => {
      this.send({ type: 'ping' });
    }, 18000);
  }

  stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}
