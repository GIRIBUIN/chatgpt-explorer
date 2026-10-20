import { webext } from "../utils/browser";
import { t } from "../i18n";
export async function request<T>(
  type: string,
  url?: string,
  mode?: import("../models/types").OpenBehavior,
  sessionId?: string,
): Promise<T> {
  const response = await webext().runtime.sendMessage({
    type,
    url,
    mode,
    sessionId,
  });
  if (!response?.ok) throw Error(response?.error ?? t("browserFailed"));
  return response.value as T;
}
