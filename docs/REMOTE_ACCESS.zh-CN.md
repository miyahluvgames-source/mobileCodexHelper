# 远程访问与 Codex 定制说明

[中文](REMOTE_ACCESS.zh-CN.md) | [English](REMOTE_ACCESS.md)

这份文档描述的是当前仓库里已经实际验证通过的方案，而不是理想化架构图。

## 当前可用链路

```text
iPhone / iPad / Mac 浏览器
   ↓
Tailscale tailnet 内部 HTTP
   ↓
本机 nginx 代理 (127.0.0.1:8080)
   ↓
本机网页服务 (127.0.0.1:3001)
   ↓
电脑上的 Codex 会话
```

当前这套仓库默认走的是：

- 本地网页入口：`http://127.0.0.1:3001`
- 本地 nginx 入口：`http://127.0.0.1:8080`
- tailnet 远程入口：`http://<hostname>`
- 例如：`http://fc-20230705vdmi`

## 重要限制

当前默认发布方式是 tailnet 内部 `HTTP`，不是 `HTTPS`。

这意味着：

- 请优先使用 `http://<hostname>`
- 不要假设 `https://<hostname>` 一定可用
- 如果浏览器、插件或代理把地址自动升级成 `https://...`，访问可能会失败

## Mac / iPhone / iPad 访问建议

先确认：

- 电脑和手机 / Mac 都已经登录同一个 Tailscale tailnet
- 电脑端已经执行过：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/enable-mobile-codex-remote.ps1
```

然后优先访问：

- `http://<hostname>`
- 如果短主机名解析不稳定，再试 `http://<hostname>.<tailnet>.ts.net`

已验证通过的访问方式示例：

- `http://fc-20230705vdmi`

## 代理与 502 问题

如果设备上开着代理软件或系统代理，tailnet 地址可能被错误转发，表现为：

- 网页无法正常运作
- 502 Bad Gateway
- 登录页能打开，但后续请求失败

优先处理方式：

- 临时关闭代理后再试
- 或者把这些地址加入直连 / bypass：
  - `*.ts.net`
  - 当前 tailnet 域名
  - `100.64.0.0/10`

## 首次设备批准

首次在新设备登录时：

1. 手机 / Mac 会显示等待电脑批准
2. 电脑端桌面控制工具会出现待审批设备
3. 你核对设备名、平台和 IP 后点击批准
4. 新设备自动继续登录

这个流程是正常的，不是故障。

## 这版仓库相对上游的主要定制

### 1. Codex 项目名和会话名同步

- 项目列表优先显示更合理的项目名，而不是整条 Windows 路径
- Codex 会话会优先读取 `.codex/session_index.jsonl` 中的 `thread_name`
- 没有可用 `thread_name` 的旧会话，仍会回退到摘要标题

### 2. 更接近 Codex Desktop 的移动端 UI

- 主视图显示项目名和会话名
- 归档会话默认隐藏
- 恢复了 `Add project`
- 每个项目卡片都提供明显的 `New Session`
- 首页和空状态文案改成更接近 Codex 的措辞

### 3. 聊天框任意文件上传

当前 hardened 模式下已经放开聊天框文件上传链路，手机端可以直接上传文件到当前项目对话。

### 4. 设备审批与桌面控制工具兼容

- 支持 pending device 审批
- 支持 trusted device 白名单
- 兼容本机当前 Codex 环境的若干差异

## 最常见的排查顺序

1. 先确认本地 `http://127.0.0.1:3001` 能打开
2. 再确认桌面工具里 app 和 nginx 都健康
3. 再确认 `tailscale serve status` 里确实代理到 `http://127.0.0.1:8080`
4. 再用另一台设备访问 `http://<hostname>`
5. 如果失败，先排查代理和自动升级到 `https`
