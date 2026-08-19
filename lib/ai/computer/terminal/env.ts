/**
 * Terminal child process 环境变量安全过滤（P0 Hardening 9）。
 *
 * 目标：不让 Agent shell 默认继承宿主 AI/API secrets。
 * 策略：复制 process.env → 按敏感变量名 pattern 删除，保留正常运行所需变量。
 */

const SENSITIVE_ENV_PATTERN = /(API_KEY|APIKEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE_KEY|CREDENTIAL|COOKIE|AUTH)/i;

export function buildSafeTerminalEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const safe: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (SENSITIVE_ENV_PATTERN.test(key)) continue;
    safe[key] = value;
  }
  return safe;
}
