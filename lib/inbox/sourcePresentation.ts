import type { InboxSource } from "@/lib/inbox/types";

export interface InboxSourcePresentation {
  label: string;
  iconSrc: string;
}

export const INBOX_SOURCE_PRESENTATION: Record<InboxSource, InboxSourcePresentation> = {
  "qq-bot": { label: "QQ", iconSrc: "/brand/channels/qq.png" },
  "qq-mail": { label: "QQ 邮箱", iconSrc: "/brand/channels/qq-mail.svg" },
  gmail: { label: "Gmail", iconSrc: "/brand/channels/gmail.svg" },
};

export function getInboxSourcePresentation(source: InboxSource): InboxSourcePresentation {
  return INBOX_SOURCE_PRESENTATION[source];
}
