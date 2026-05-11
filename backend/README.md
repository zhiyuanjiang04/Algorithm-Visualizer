# Backend 说明

本目录为算法可视化系统后端服务，负责：

- 输入数据校验
- 算法步骤拆解
- WebSocket 实时推送步骤数据
- 多会话隔离（`sessionId`）

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

请求示例：

```json
{
  "sessionId": "demo-1",
  "algorithm": "heap_build",
  "input": [7,2,9,1,5,8,3,6,4]
}
```

### 3.3 WebSocket

- 本机：`ws://127.0.0.1:8080/ws`
- 其他设备：`ws://<服务器IP或域名>:8080/ws`

客户端消息：`hello/start/pause/resume/step/reset/ping`

服务端消息：`connected/step/done/error/pong`

## 4. 备注

- `heap_build` 要求输入 9 个整数（按实验要求）
- `quick_sort` 作为扩展算法演示
- 若部署到服务器，请确保安全组/防火墙放行 `8080`
