import { useState } from "react";
import { useAgent } from "@bcr/react";

export function EndpointSettings() {
  const agent = useAgent();
  const [baseUrl, setBaseUrl] = useState(agent.endpoint.baseUrl);
  const [apiKey, setApiKey] = useState(agent.endpoint.apiKey);
  const [model, setModel] = useState(agent.endpoint.model);
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="bcr-chat-settings"
      onSubmit={(event) => {
        event.preventDefault();
        agent.setEndpoint({ baseUrl, apiKey, model });
        setSaved(true);
      }}
    >
      <label>
        接口地址
        <input
          required
          aria-label="AI 接口地址"
          placeholder="/api/llm/v1"
          value={baseUrl}
          onChange={(event) => {
            setBaseUrl(event.target.value);
            setSaved(false);
          }}
        />
      </label>
      <label>
        模型
        <input
          required
          aria-label="AI 模型名称"
          placeholder="mimo-v2.6-pro"
          value={model}
          onChange={(event) => {
            setModel(event.target.value);
            setSaved(false);
          }}
        />
      </label>
      <label>
        密钥
        <input
          aria-label="AI 接口密钥"
          type="password"
          autoComplete="off"
          placeholder="本地接口可留空"
          value={apiKey}
          onChange={(event) => {
            setApiKey(event.target.value);
            setSaved(false);
          }}
        />
      </label>
      <button type="submit" className="bcr-chat-button">
        保存到本次会话
      </button>
      {saved && <span role="status">接口配置已更新</span>}
      <p className="bcr-chat-hint">
        密钥仅保存在本页内存。支持同源路径
        /api/llm/v1（需服务端启用代理）；直连接口须允许当前页面跨域访问。
      </p>
    </form>
  );
}
