# Backend 说明

本目录为算法可视化系统后端服务，负责：

- 输入数据校验
- 算法步骤拆解
- WebSocket 实时推送步骤数据
- 多会话隔离（`sessionId`）
- 同会话多次提交下的运行隔离（`runId`）

## 1. 环境要求

- Python 3.10+

## 2. 安装与运行

```bash
cd backend
python3 -m pip install -r requirements.txt
python3 app.py
```

默认监听：`0.0.0.0:8080`

- 本机访问：`http://127.0.0.1:8080`
- 其他设备访问：`http://<服务器IP或域名>:8080`

## 3. 接口

### 3.1 健康检查

- `GET /api/health`

示例响应：

```json
{"ok": true, "sessions": 1}
```

### 3.2 提交可视化任务

- `POST /api/visualize`
- 必填字段：`sessionId`、`runId`、`algorithm`、`input`

请求示例：

```json
{
  "sessionId": "demo-1",
  "runId": "run-001",
  "algorithm": "heap_build",
  "input": [7,2,9,1,5,8,3,6,4]
}
```

说明：

- `runId` 必须由前端每次“提交并开始”时新生成。
- 后端会将该值记录为当前会话最新任务 `current_run_id`。
- 后续若有更“新”的任务写入，旧任务推送线程会自动停止。

### 3.3 WebSocket

- 本机：`ws://127.0.0.1:8080/ws`
- 其他设备：`ws://<服务器IP或域名>:8080/ws`

客户端消息：`hello/start/pause/resume/step/reset/ping`

服务端消息：`connected/step/done/error/pong`

`start` 消息示例：

```json
{
  "type": "start",
  "sessionId": "demo-1",
  "runId": "run-001",
  "algorithm": "heap_build",
  "speed": "normal"
}
```

防串流机制：

- `start` 必须携带 `runId`。
- 若 `start.runId != current_run_id`，后端返回错误：
  - `stale run: 不是当前最新任务`
- 每条 `step/done/error/reset` 消息都带 `runId`，前端按当前任务过滤。

## 4. 备注

- `heap_build` 要求输入 9 个整数（按实验要求）
- `quick_sort` 作为扩展算法演示
- 若部署到服务器，请确保安全组/防火墙放行 `8080`
