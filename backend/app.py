import asyncio
import json
import socket
import struct
import hashlib
import base64
import threading
import time


# ============ 配置 ============
HOST = "0.0.0.0"
PORT = 8080
# 允许的Origin（* 表示允许所有，生产环境建议指定域名）
ALLOWED_ORIGIN = "*"


# ============ 数据存储 ============
class SessionState:
    def __init__(self, session_id):
        self.session_id = session_id
        self.algorithm = "heap_build"
        self.input_data = []
        self.current_run_id = ""
        self.speed = "normal"
        self.paused = False
        self.step_mode = False
        self.resume_event = threading.Event()
        self.step_event = threading.Event()
        self.resume_event.set()


SESSIONS = {}
SPEED_MAP = {"slow": 1.2, "normal": 0.65, "fast": 0.28}


def get_or_create_session(session_id):
    if session_id not in SESSIONS:
        SESSIONS[session_id] = SessionState(session_id)
    return SESSIONS[session_id]


# ============ 算法步骤生成 ============
def parse_int_list(values):
    if not isinstance(values, list):
        return False, [], "input 必须是整数数组"
    out = []
    for v in values:
        if isinstance(v, bool):
            return False, [], "input 必须是整数数组"
        if not isinstance(v, int):
            return False, [], "input 必须是整数数组"
        out.append(v)
    if len(out) < 2:
        return False, [], "请至少输入 2 个整数"
    return True, out, ""


def step_builder(algorithm):
    sid = [0]

    def make_step(arr, description, **extra):
        sid[0] += 1
        payload = {
            "id": sid[0],
            "algorithm": algorithm,
            "description": description,
            "array": arr[:],
        }
        payload.update(extra)
        return payload

    return make_step


def build_heap_steps(values):
    arr = values[:]
    mk = step_builder("heap_build")
    steps = [mk(arr, "初始数组，准备构建大顶堆。")]

    def push(desc, **kwargs):
        steps.append(mk(arr, desc, **kwargs))

    def sift_down(start, end):
        root = start
        while root * 2 + 1 <= end:
            left = root * 2 + 1
            right = left + 1
            candidate = left
            if right <= end:
                push("比较左右子节点，选择更大的子节点。", active=root, compare=[left, right])
                if arr[right] > arr[left]:
                    candidate = right
            push("比较父节点 a[{}] 与候选子节点 a[{}]。".format(root, candidate),
                 active=root, compare=[candidate])
            if arr[root] < arr[candidate]:
                i, j = root, candidate
                arr[i], arr[j] = arr[j], arr[i]
                push("交换 a[{}] 与 a[{}]，继续向下调整。".format(i, j),
                     active=i, compare=[j], swap=[i, j])
                root = candidate
            else:
                push("节点 a[{}] 已满足堆性质，本轮筛选结束。".format(root),
                     active=root, doneRange=[start, end])
                return

    for i in range((len(arr) - 2) // 2, -1, -1):
        push("从最后一个非叶子节点开始筛选：i={}。".format(i), active=i)
        sift_down(i, len(arr) - 1)
    push("堆创建完成，当前数组满足大顶堆。", doneRange=[0, len(arr) - 1])
    return steps


def build_quick_steps(values):
    arr = values[:]
    mk = step_builder("quick_sort")
    steps = [mk(arr, "初始数组，准备执行快速排序。")]

    def push(desc, **kwargs):
        steps.append(mk(arr, desc, **kwargs))

    def partition(l, r):
        pivot = arr[r]
        i = l - 1
        push("选择区间 [{}, {}] 末尾元素 {} 作为基准。".format(l, r, pivot), active=r, doneRange=[l, r])
        for j in range(l, r):
            push("比较 a[{}]={} 与基准 {}。".format(j, arr[j], pivot),
                 active=r, compare=[j], doneRange=[l, r])
            if arr[j] <= pivot:
                i += 1
                if i != j:
                    arr[i], arr[j] = arr[j], arr[i]
                    push("a[{}] <= 基准，交换 a[{}] 与 a[{}]。".format(j, i, j),
                         active=r, compare=[i, j], swap=[i, j], doneRange=[l, r])
                else:
                    push("a[{}] <= 基准，位置保持不变。".format(j),
                         active=r, compare=[j], doneRange=[l, r])
        p = i + 1
        if p != r:
            arr[p], arr[r] = arr[r], arr[p]
            push("将基准放到最终位置 p={}。".format(p),
                 active=p, compare=[r], swap=[p, r], doneRange=[l, r])
        else:
            push("基准已在正确位置 p={}。".format(p), active=p, doneRange=[l, r])
        return p

    def qsort(l, r):
        if l > r:
            return
        if l == r:
            push("区间 [{}, {}] 只有一个元素，天然有序。".format(l, r), active=l, doneRange=[l, r])
            return
        p = partition(l, r)
        qsort(l, p - 1)
        qsort(p + 1, r)

    qsort(0, len(arr) - 1)
    push("快速排序完成，数组有序。", doneRange=[0, len(arr) - 1])
    return steps


def build_steps(algorithm, values):
    if algorithm == "quick_sort":
        return build_quick_steps(values)
    return build_heap_steps(values)


# ============ WebSocket 协议实现 ============
class WebSocketHandler:
    MAGIC = b"258EAFA5-E914-47DA-95CA-5AB0AC1B2B80"
    
    def __init__(self, client_socket, addr, headers=None):
        self.client_socket = client_socket
        self.addr = addr
        self.handshaked = False
        self.headers = headers or {}
        self._raw_request = b""
    
    def start(self):
        try:
            # 如果还没有解析完headers，继续读取
            data = b""
            if b"\r\n\r\n" not in self._raw_request:
                while b"\r\n\r\n" not in (self._raw_request + data):
                    chunk = self.client_socket.recv(4096)
                    if not chunk:
                        return
                    data += chunk
                full_data = self._raw_request + data
            else:
                full_data = self._raw_request
            
            headers = self._parse_headers(full_data)
            key = headers.get("sec-websocket-key", "")
            
            if not key:
                # 缺少WebSocket key，可能是普通HTTP请求
                self._send_400("Missing Sec-WebSocket-Key")
                return
            
            # 检查WebSocket版本
            version = headers.get("sec-websocket-version", "13")
            
            accept = self._compute_accept(key)
            
            # 构建响应头
            response_headers = {
                "Upgrade": "websocket",
                "Connection": "Upgrade",
                "Sec-WebSocket-Accept": accept,
                "Sec-WebSocket-Version": "13",
            }
            
            # 处理Origin（跨域）
            origin = headers.get("origin", "")
            if origin:
                response_headers["Access-Control-Allow-Origin"] = ALLOWED_ORIGIN
                response_headers["Access-Control-Allow-Headers"] = "*"
                response_headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
            
            # 构建HTTP响应
            response = "HTTP/1.1 101 Switching Protocols\r\n"
            for k, v in response_headers.items():
                response += "{}: {}\r\n".format(k, v)
            response += "\r\n"
            
            self.client_socket.sendall(response.encode())
            self.handshaked = True
            
            self._handle_messages()
        except Exception as e:
            print("WebSocket Error: {}".format(e))
        finally:
            self.client_socket.close()
    
    def _send_400(self, message):
        try:
            body = json.dumps({"error": message})
            response = (
                "HTTP/1.1 400 Bad Request\r\n"
                "Content-Type: application/json\r\n"
                "Access-Control-Allow-Origin: {}\r\n"
                "Content-Length: {}\r\n"
                "\r\n"
                "{}"
            ).format(ALLOWED_ORIGIN, len(body), body)
            self.client_socket.sendall(response.encode())
        except Exception:
            pass
    
    def _parse_headers(self, data):
        headers = {}
        text = data.decode("utf-8", errors="ignore")
        for line in text.split("\r\n")[1:]:
            if not line or line == "\r\n":
                break
            if ":" in line:
                key, value = line.split(":", 1)
                headers[key.strip().lower()] = value.strip()
        return headers
    
    def _compute_accept(self, key):
        sha1 = hashlib.sha1((key + self.MAGIC.decode()).encode()).digest()
        return base64.b64encode(sha1).decode()
    
    def _handle_messages(self):
        while True:
            try:
                msg = self._read_message()
                if msg is None:
                    break
                self._process_message(msg)
            except Exception:
                break
    
    def _read_message(self):
        header = self.client_socket.recv(2)
        if len(header) < 2:
            return None
        
        opcode = header[0] & 0x0F
        masked = (header[1] >> 7) & 1
        length = header[1] & 0x7F
        
        if length == 126:
            length = struct.unpack("!H", self.client_socket.recv(2))[0]
        elif length == 127:
            length = struct.unpack("!Q", self.client_socket.recv(8))[0]
        
        if masked:
            mask = self.client_socket.recv(4)
        
        payload = b""
        while len(payload) < length:
            chunk = self.client_socket.recv(length - len(payload))
            if not chunk:
                return None
            payload += chunk
        
        if masked:
            payload = bytes([payload[i] ^ mask[i % 4] for i in range(len(payload))])
        
        if opcode == 0x8:
            return None
        elif opcode == 0x9:
            self._send_pong()
            return None
        elif opcode == 0x1:
            return payload.decode("utf-8")
        return None
    
    def _send_pong(self):
        pong = struct.pack("!BB", 0x8A, 0)
        self.client_socket.sendall(pong)
    
    def send_json(self, data):
        if not self.handshaked:
            return False
        try:
            msg = json.dumps(data, ensure_ascii=False).encode("utf-8")
            frame = bytearray()
            frame.append(0x81)
            length = len(msg)
            if length <= 125:
                frame.append(length)
            elif length <= 65535:
                frame.append(126)
                frame.extend(struct.pack("!H", length))
            else:
                frame.append(127)
                frame.extend(struct.pack("!Q", length))
            frame.extend(msg)
            self.client_socket.sendall(bytes(frame))
            return True
        except Exception:
            return False
    
    def _process_message(self, text):
        try:
            msg = json.loads(text)
        except Exception:
            return
        
        mtype = str(msg.get("type", "")).strip()
        session_id = str(msg.get("sessionId", "")).strip()
        
        if not session_id:
            self.send_json({"type": "error", "message": "缺少 sessionId"})
            return
        
        state = get_or_create_session(session_id)
        
        if mtype == "hello":
            self.send_json({"type": "connected", "sessionId": state.session_id})
        elif mtype == "ping":
            self.send_json({"type": "pong"})
        elif mtype == "start":
            run_id = str(msg.get("runId", "")).strip()
            if not run_id:
                self.send_json({"type": "error", "message": "缺少 runId"})
                return

            # 只允许启动当前最新任务，旧任务直接拒绝
            if not state.current_run_id or run_id != state.current_run_id:
                self.send_json({
                    "type": "error",
                    "sessionId": state.session_id,
                    "runId": run_id,
                    "message": "stale run: 不是当前最新任务"
                })
                return

            state.speed = str(msg.get("speed", "normal"))
            state.algorithm = str(msg.get("algorithm", state.algorithm))
            state.input_data = msg.get("input", state.input_data)
            state.paused = False
            state.step_mode = False
            state.resume_event.set()
            state.step_event.clear()
            # 如果还没有input_data，需要先从消息中获取
            if not state.input_data:
                # 尝试从之前的消息中获取，或者使用默认值
                pass
            threading.Thread(target=self._run_steps, args=(state, self, run_id), daemon=True).start()
        elif mtype == "pause":
            state.paused = True
            state.resume_event.clear()
        elif mtype == "resume":
            state.paused = False
            state.resume_event.set()
        elif mtype == "step":
            state.step_mode = True
            state.paused = False
            state.resume_event.set()
            state.step_event.set()
        elif mtype == "reset":
            state.paused = False
            state.step_mode = False
            state.resume_event.set()
            state.step_event.clear()
            self.send_json({"type": "done", "sessionId": state.session_id, "runId": state.current_run_id, "message": "已重置"})

    def _run_steps(self, state, ws, run_id):
        steps = build_steps(state.algorithm, state.input_data)
        delay = SPEED_MAP.get(state.speed, SPEED_MAP["normal"])
        
        for step in steps:
            # 如果当前线程对应的 runId 已过期，则立刻终止推送
            if run_id != state.current_run_id:
                return

            while state.paused:
                if run_id != state.current_run_id:
                    return
                state.resume_event.wait(timeout=0.2)
                state.resume_event.clear()
            
            if state.step_mode:
                while True:
                    if run_id != state.current_run_id:
                        return
                    if state.step_event.wait(timeout=0.2):
                        state.step_event.clear()
                        break
            
            if run_id != state.current_run_id:
                return
            ws.send_json({
                "type": "step",
                "sessionId": state.session_id,
                "runId": run_id,
                "payload": step
            })
            time.sleep(delay)
        
        if run_id == state.current_run_id:
            ws.send_json({
                "type": "done",
                "sessionId": state.session_id,
                "runId": run_id,
                "message": "演示完成"
            })


# ============ HTTP 请求处理 ============
class APIHandler:
    def __init__(self, client_socket, addr, first_line):
        self.client_socket = client_socket
        self.addr = addr
        self.first_line = first_line
    
    def handle(self):
        try:
            # 读取剩余的 HTTP 数据
            remaining = b""
            if b"\r\n\r\n" not in self.first_line:
                while b"\r\n\r\n" not in (self.first_line + remaining):
                    chunk = self.client_socket.recv(4096)
                    if not chunk:
                        break
                    remaining += chunk
            
            full_data = self.first_line + remaining
            
            # 解析请求
            lines = full_data.split(b"\r\n")
            request_line = lines[0].decode("utf-8", errors="ignore")
            parts = request_line.split(" ")
            if len(parts) < 2:
                return
            
            method = parts[0]
            path = parts[1].split("?")[0]  # 去掉查询参数
            
            # 解析头
            headers = {}
            body_start = full_data.find(b"\r\n\r\n")
            if body_start == -1:
                body_start = len(full_data)
            else:
                body_start += 4
            
            for line in lines[1:]:
                if not line or line == b"\r\n":
                    break
                try:
                    text = line.decode("utf-8", errors="ignore")
                    if ":" in text:
                        key, value = text.split(":", 1)
                        headers[key.strip().lower()] = value.strip()
                except Exception:
                    pass
            
            body = full_data[body_start:].decode("utf-8", errors="ignore") if body_start < len(full_data) else ""
            
            # 处理请求（包括OPTIONS预检请求）
            if method == "OPTIONS":
                self._send_cors_response(200)
            elif method == "GET" and path == "/api/health":
                self._send_json({"ok": True, "sessions": len(SESSIONS)})
            elif method == "POST" and path == "/api/visualize":
                self._handle_visualize(body)
            elif method == "GET" and path == "/ws":
                # 浏览器可能先发送GET请求到/ws路径
                self._send_cors_response(200)
            else:
                self._send_response(404, "Not Found", "")
        except Exception as e:
            print("HTTP Error: {}".format(e))
        finally:
            self.client_socket.close()
    
    def _send_cors_response(self, status):
        """发送带CORS头的响应"""
        body = ""
        status_map = {200: "OK", 404: "Not Found"}
        status_str = "{} {}".format(status, status_map.get(status, "Unknown"))
        
        response = "HTTP/1.1 {}\r\n".format(status_str)
        response += "Content-Type: text/plain\r\n"
        response += "Access-Control-Allow-Origin: {}\r\n".format(ALLOWED_ORIGIN)
        response += "Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS\r\n"
        response += "Access-Control-Allow-Headers: Content-Type, Authorization\r\n"
        response += "Access-Control-Allow-Credentials: true\r\n"
        response += "Content-Length: {}\r\n".format(len(body))
        response += "\r\n"
        response += body
        
        try:
            self.client_socket.sendall(response.encode())
        except Exception:
            pass
    
    def _send_response(self, status, status_text, body):
        status_map = {200: "OK", 404: "Not Found", 400: "Bad Request"}
        status_str = "{} {}".format(status, status_map.get(status, "Unknown"))
        
        response = "HTTP/1.1 {}\r\n".format(status_str)
        response += "Content-Type: text/plain\r\n"
        response += "Access-Control-Allow-Origin: *\r\n"
        response += "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
        response += "Access-Control-Allow-Headers: Content-Type\r\n"
        response += "Content-Length: {}\r\n".format(len(body))
        response += "\r\n"
        response += body
        
        try:
            self.client_socket.sendall(response.encode())
        except Exception:
            pass
    
    def _send_json(self, data):
        body = json.dumps(data, ensure_ascii=False)
        response = "HTTP/1.1 200 OK\r\n"
        response += "Content-Type: application/json\r\n"
        response += "Access-Control-Allow-Origin: *\r\n"
        response += "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
        response += "Access-Control-Allow-Headers: Content-Type\r\n"
        response += "Content-Length: {}\r\n".format(len(body.encode("utf-8")))
        response += "\r\n"
        
        try:
            self.client_socket.sendall(response.encode())
            self.client_socket.sendall(body.encode("utf-8"))
        except Exception:
            pass
    
    def _handle_visualize(self, body):
        try:
            payload = json.loads(body)
        except Exception:
            self._send_json({"ok": False, "message": "无效 JSON"})
            return
        
        session_id = str(payload.get("sessionId", "")).strip()
        run_id = str(payload.get("runId", "")).strip()
        algorithm = str(payload.get("algorithm", "heap_build")).strip() or "heap_build"
        input_values = payload.get("input", [])
        
        if not session_id:
            self._send_json({"ok": False, "message": "缺少 sessionId"})
            return
        if not run_id:
            self._send_json({"ok": False, "message": "缺少 runId"})
            return
        
        ok, arr, msg = parse_int_list(input_values)
        if not ok:
            self._send_json({"ok": False, "message": msg})
            return
        
        if algorithm == "heap_build" and len(arr) != 9:
            self._send_json({"ok": False, "message": "堆创建要求输入 9 个整数"})
            return
        
        state = get_or_create_session(session_id)
        state.algorithm = algorithm
        state.input_data = arr
        state.current_run_id = run_id
        state.paused = False
        state.step_mode = False
        state.resume_event.set()
        state.step_event.clear()
        
        self._send_json({"ok": True, "message": "accepted", "sessionId": session_id, "runId": run_id})


# ============ 服务器 ============
class HybridServer:
    def __init__(self, host, port):
        self.host = host
        self.port = port
        self.server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.server.bind((host, port))
        self.server.listen(128)
        print("Server running on {}:{}".format(host, port))
    
    def run(self):
        while True:
            client, addr = self.server.accept()
            first_line = b""
            while b"\n" not in first_line:
                chunk = client.recv(1)
                if not chunk:
                    client.close()
                    break
                first_line += chunk
            
            # 更可靠的WebSocket检测
            first_line_lower = first_line.lower()
            is_websocket = (
                b"upgrade: websocket" in first_line_lower or
                b"sec-websocket-key" in first_line_lower or
                b"get /ws" in first_line_lower or
                b"sec-websocket-version" in first_line_lower
            )
            
            if is_websocket:
                handler = WebSocketHandler(client, addr)
                handler._raw_request = first_line
                threading.Thread(target=handler.start, daemon=True).start()
            else:
                handler = APIHandler(client, addr, first_line)
                threading.Thread(target=handler.handle, daemon=True).start()


if __name__ == "__main__":
    server = HybridServer(HOST, PORT)
    try:
        server.run()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.server.close()
