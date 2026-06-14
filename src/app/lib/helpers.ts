import type { ProjectStatus, TicketStatus, Priority, Role, Sprint, SprintStatus, SprintTicket } from "@/app/types";

// Compute sprint status dynamically from ticket states + deadline
export function computeSprintStatus(sprint: Sprint): SprintStatus {
  const today = new Date().toISOString().split("T")[0];
  const { tickets, endDate } = sprint;
  const active: TicketStatus[] = ["in-progress", "in-review", "review-done", "stg-test", "uat", "done"];
  if (tickets.length > 0 && tickets.every((t: SprintTicket) => t.status === "done" || t.status === "closed")) return "completed";
  if (endDate && endDate < today) return "delayed";
  if (tickets.some((t: SprintTicket) => active.includes(t.status))) return "active";
  return "planning";
}

export function getStatusMeta(status: ProjectStatus | TicketStatus) {
  const map: Record<string, { label: string; cls: string; dot: string; bar: string }> = {
    planning: { label: "計画中", cls: "bg-slate-100 text-slate-600", dot: "bg-slate-400", bar: "bg-slate-300" },
    "in-progress": { label: "進行中", cls: "bg-orange-50 text-orange-700", dot: "bg-orange-400", bar: "bg-orange-400" },
    completed: { label: "完了", cls: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500", bar: "bg-emerald-500" },
    "on-hold": { label: "保留中", cls: "bg-amber-50 text-amber-700", dot: "bg-amber-400", bar: "bg-amber-400" },
    todo: { label: "未着手", cls: "bg-stone-100 text-stone-500", dot: "bg-stone-400", bar: "bg-stone-300" },
    done: { label: "完了", cls: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500", bar: "bg-emerald-500" },
    "in-review": { label: "レビュー中", cls: "bg-violet-50 text-violet-700", dot: "bg-violet-500", bar: "bg-violet-500" },
    "review-done": { label: "レビュー完了", cls: "bg-sky-50 text-sky-700", dot: "bg-sky-500", bar: "bg-sky-500" },
    "stg-test": { label: "STG完了", cls: "bg-teal-50 text-teal-700", dot: "bg-teal-500", bar: "bg-teal-500" },
    uat: { label: "UAT完了", cls: "bg-indigo-50 text-indigo-700", dot: "bg-indigo-500", bar: "bg-indigo-500" },
    closed: { label: "クローズ", cls: "bg-stone-200 text-stone-500", dot: "bg-stone-500", bar: "bg-stone-400" },
  };
  return map[status] ?? { label: status, cls: "bg-stone-100 text-stone-500", dot: "bg-stone-400", bar: "bg-stone-300" };
}

export const TICKET_STATUSES = [
  { value: "todo", label: "未着手", color: "#6B7280", bg: "#F3F4F6" },
  { value: "in-progress", label: "進行中", color: "#D97706", bg: "#FFF7ED" },
  { value: "in-review", label: "レビュー中", color: "#7C3AED", bg: "#F5F3FF" },
  { value: "pending", label: "保留中", color: "#DC2626", bg: "#FEF2F2" }, // 🌟 これを追加！
  // ...  { value: "in-review",   label: "レビュー中",   color: "#7C3AED", bg: "#F5F3FF" },
  { value: "review-done", label: "レビュー完了", color: "#0284C7", bg: "#F0F9FF" },
  { value: "stg-test", label: "STG完了", color: "#0D9488", bg: "#F0FDFA" },
  { value: "uat", label: "UAT完了", color: "#4F46E5", bg: "#EEF2FF" },
  { value: "closed", label: "クローズ", color: "#6B7280", bg: "#F3F4F6" },
];

export function getPriorityMeta(p: Priority) {
  return {
    high: { label: "高", cls: "bg-red-50 text-red-600", dot: "bg-red-500" },
    medium: { label: "中", cls: "bg-amber-50 text-amber-700", dot: "bg-amber-400" },
    low: { label: "低", cls: "bg-sky-50 text-sky-600", dot: "bg-sky-400" },
  }[p];
}

export function getRoleMeta(role: Role) {
  const map: Record<string, { label: string; cls: string; gradient: string }> = {
    admin: { label: "管理者", cls: "bg-rose-50 text-rose-700", gradient: "from-rose-500 to-rose-600" },
    "project-manager": { label: "PM", cls: "bg-orange-50 text-orange-700", gradient: "from-orange-500 to-orange-600" },
    developer: { label: "開発者", cls: "bg-sky-50 text-sky-700", gradient: "from-sky-500 to-sky-600" },
    designer: { label: "デザイナー", cls: "bg-violet-50 text-violet-700", gradient: "from-violet-500 to-violet-600" },
  };
  return map[role] ?? { label: role, cls: "bg-gray-50 text-gray-700", gradient: "from-gray-400 to-gray-500" };
}

export function getAvatarColor(name: string) {
  const colors = ["#059669", "#D97706", "#059669", "#0284C7", "#7C3AED", "#DB2777"];
  return colors[name.charCodeAt(0) % colors.length];
}

// 案1+案2: 日次8h上限＋夜間(23時〜翌8時)除外で実働時間を計算
// 初日はactual開始時刻から、翌日以降は9時スタート、各日最大8h
export function calcWorkingHours(startMs: number, endMs: number): number {
  if (endMs <= startMs) return 0;
  const NIGHT_END = 8, NEXT_DAY = 9, NIGHT_START = 23, MAX_PER_DAY = 8;
  let total = 0;
  const s = new Date(startMs);
  let cur = new Date(s.getFullYear(), s.getMonth(), s.getDate());
  const last = new Date(endMs);
  const lastDay = new Date(last.getFullYear(), last.getMonth(), last.getDate());
  let isFirst = true;
  while (cur.getTime() <= lastDay.getTime()) {
    const y = cur.getFullYear(), mo = cur.getMonth(), d = cur.getDate();
    const eff0 = isFirst
      ? Math.max(startMs, new Date(y, mo, d, NIGHT_END).getTime())
      : new Date(y, mo, d, NEXT_DAY).getTime();
    const eff1 = Math.min(endMs, new Date(y, mo, d, NIGHT_START).getTime());
    if (eff1 > eff0) total += Math.min((eff1 - eff0) / 3600000, MAX_PER_DAY);
    cur = new Date(y, mo, d + 1);
    isFirst = false;
  }
  return total;
}

export function calcTicketActualHours(ticket: {
  startedAt?: string | null;
  reviewRequestedAt?: string | null;
  reviewApprovedAt?: string | null;
  stgCompletedAt?: string | null;
  uatCompletedAt?: string | null;
  releasedAt?: string | null;
}): number {
  const ts = [
    ticket.startedAt,
    ticket.reviewRequestedAt,
    ticket.reviewApprovedAt,
    ticket.stgCompletedAt,
    ticket.uatCompletedAt,
    ticket.releasedAt,
  ];
  let total = 0;
  for (let i = 1; i < ts.length; i++) {
    const prev = ts[i - 1];
    const cur = ts[i];
    if (!prev || !cur) continue;
    // レビュー依頼→承認が同一タイムスタンプ = カスケード記録（スキップ）
    if (i === 2 && prev === cur) continue;
    total += calcWorkingHours(new Date(prev).getTime(), new Date(cur).getTime());
  }
  return total;
}

export function formatPersonDays(hours: number): string {
  if (hours <= 0) return "0人日";
  const pd = Math.round((hours / 8) * 10) / 10;
  if (pd < 0.1) return "0.1人日未満";
  return `${pd}人日`;
}

export function formatActualHours(hours: number): string {
  return formatPersonDays(hours);
}

export function calcProgress(done: number, ip: number, todo: number) {
  const t = done + ip + todo; return t === 0 ? 0 : Math.round((done / t) * 100);
}

export function getInitials(n: string) { return (n || "?").replace(/\s/g, "").slice(0, 2); }

export function truncateName(name: string | null | undefined, maxWidth = 14): string {
  if (!name) return "";
  let w = 0;
  let out = "";
  for (const ch of name) {
    const cw = /[　-鿿＀-￯]/.test(ch) ? 2 : 1;
    if (w + cw > maxWidth) return out + "...";
    w += cw;
    out += ch;
  }
  return out;
}
export function formatDate(d: string | null | undefined) { if (!d) return "—"; return d.slice(5).replace("-", "/"); }
export function htmlToText(html: string | undefined | null): string {
  if (!html) return "";
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent || div.innerText || "";
}
export function htmlToMarkdown(html: string | undefined | null): string {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");

  function walk(node: Node, listDepth = 0): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const ch = () => Array.from(el.childNodes).map(c => walk(c, listDepth)).join("");

    if (tag === "p") return ch().trim() + "\n\n";
    if (tag === "br") return "\n";
    if (tag === "strong" || tag === "b") return `**${ch()}**`;
    if (tag === "em" || tag === "i") return `*${ch()}*`;
    if (tag === "s" || tag === "del" || tag === "strike") return `~~${ch()}~~`;
    if (tag === "code") {
      if (el.parentElement?.tagName.toLowerCase() === "pre") return el.textContent ?? "";
      return `\`${el.textContent ?? ""}\``;
    }
    if (tag === "pre") {
      const code = el.querySelector("code")?.textContent ?? el.textContent ?? "";
      return `\`\`\`\n${code.trim()}\n\`\`\`\n\n`;
    }
    if (tag === "blockquote") {
      return ch().trim().split("\n").map(l => `> ${l}`).join("\n") + "\n\n";
    }
    if (tag === "h1") return `# ${ch().trim()}\n`;
    if (tag === "h2") return `## ${ch().trim()}\n`;
    if (tag === "h3") return `### ${ch().trim()}\n`;
    if (tag === "ul" || tag === "ol") {
      const indent = "  ".repeat(listDepth);
      const lines: string[] = [];
      let idx = 0;
      el.querySelectorAll(":scope > li").forEach(li => {
        idx++;
        const bullet = tag === "ul" ? `${indent}- ` : `${indent}${idx}. `;
        let text = "";
        let nestedMd = "";
        Array.from(li.childNodes).forEach(c => {
          const cTag = (c as Element).tagName?.toLowerCase();
          if (cTag === "ul" || cTag === "ol") {
            nestedMd += walk(c, listDepth + 1);
          } else {
            text += walk(c, listDepth);
          }
        });
        lines.push(bullet + text.replace(/\n+/g, " ").trim());
        if (nestedMd.trim()) lines.push(nestedMd.trimEnd());
      });
      return lines.join("\n") + "\n\n";
    }
    if (tag === "table") {
      const rows = Array.from(el.querySelectorAll("tr"));
      if (!rows.length) return "";
      const getRow = (r: Element) =>
        "| " + Array.from(r.querySelectorAll("th,td")).map(c => c.textContent?.trim() ?? "").join(" | ") + " |";
      const header = getRow(rows[0]);
      const sep = "| " + Array.from(rows[0].querySelectorAll("th,td")).map(() => "---").join(" | ") + " |";
      return [header, sep, ...rows.slice(1).map(getRow)].join("\n") + "\n";
    }
    return ch();
  }

  return Array.from(doc.body.childNodes)
    .map(n => walk(n))
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function daysBetween(a: string, b: string) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

export function getSprintStatusMeta(status: SprintStatus) {
  return ({
    planning: { label: "計画中", bg: "#F4F5F6", color: "#6B6458", dot: "#B0A9A4", barColor: "#B0A9A4" },
    active: { label: "進行中", bg: "#ECFDF5", color: "#059669", dot: "#059669", barColor: "#059669" },
    completed: { label: "完了", bg: "#F0F9FF", color: "#0284C7", dot: "#0284C7", barColor: "#0284C7" },
    delayed: { label: "遅延", bg: "#FEF2F2", color: "#DC2626", dot: "#DC2626", barColor: "#DC2626" },
  } as Record<string, { label: string; bg: string; color: string; dot: string; barColor: string }>)[status]
    ?? { label: status, bg: "#F4F5F6", color: "#6B6458", dot: "#B0A9A4", barColor: "#B0A9A4" };
}

export function sprintProgress(s: Sprint) {
  if (!s.tickets.length) return 0;
  return Math.round(s.tickets.filter(t => t.status === "done" || t.status === "closed").length / s.tickets.length * 100);
}

export const inputCls = "w-full bg-[#F7F8F9] border border-stone-200/70 rounded-xl px-3.5 py-2.5 text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400 focus:bg-white transition-all";
export const labelCls = "block text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-1.5";

// 親チケットのステータス変更時に子チケットの状態を検証する。
// 将来的に孫チケット対応を実装予定（現在は1階層のみ）。
const PARENT_STATUS_MIN_CHILD_RANK: Partial<Record<TicketStatus, number>> = {
  "in-review": 3, // review-done
  "stg-test": 4, // stg-test
  "uat": 5, // uat
  "done": 6, // done
  "closed": 6, // done or closed
};
const STATUS_VALIDATION_LABEL: Partial<Record<TicketStatus, string>> = {
  "in-review": "レビュー完了",
  "stg-test": "STG完了",
  "uat": "UAT完了",
  "done": "完了",
  "closed": "完了",
};
const STATUS_RANK: Record<TicketStatus, number> = {
  todo: 0, "in-progress": 1, "in-review": 2, "review-done": 3,
  "stg-test": 4, uat: 5, done: 6, closed: 7,
};
export function validateParentStatusChange(targetStatus: TicketStatus, childTickets: SprintTicket[]): string | null {
  if (childTickets.length === 0) return null;
  const minRank = PARENT_STATUS_MIN_CHILD_RANK[targetStatus];
  if (minRank === undefined) return null;
  const blocking = childTickets.filter(c => (STATUS_RANK[c.status] ?? 0) < minRank);
  if (blocking.length === 0) return null;
  const reqLabel = STATUS_VALIDATION_LABEL[targetStatus] ?? targetStatus;
  return `子チケット ${blocking.length}件が「${reqLabel}」に達していないため変更できません。`;
}
