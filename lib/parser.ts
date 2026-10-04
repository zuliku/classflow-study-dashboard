import { Course, CourseSchedule } from "@/types";
import { timeToMinutes, isValidTimeRange } from "@/lib/schedule";

export interface ParsedImportResult {
  courses: Course[];
  schedules: CourseSchedule[];
  warnings: string[];
  errors: string[];
}

// ---------- iCal (.ics) ----------

function unfoldICSLines(text: string): string[] {
  return text
    .replace(/\r\n?[ \t]/g, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function splitProperty(line: string): { head: string; value: string } | null {
  const colonIdx = line.indexOf(":");
  if (colonIdx <= 0) return null;
  return { head: line.slice(0, colonIdx), value: line.slice(colonIdx + 1) };
}

function getProperty(lines: string[], name: string): { head: string; value: string } | null {
  const upperName = name.toUpperCase();
  for (const line of lines) {
    const upper = line.toUpperCase();
    // 支持普通形式 (DTSTART:...) 与带参数形式 (DTSTART;TZID=Asia/Shanghai:...)
    if (upper.startsWith(`${upperName}:`) || upper.startsWith(`${upperName};`)) {
      return splitProperty(line);
    }
  }
  return null;
}

/**
 * 解析 DTSTART / DTEND 的常见形式。
 * - 本地浮动时间（无 Z/无 TZID）：按墙钟直接构造本地 Date（不再误用 Date.UTC，避免跨时区差一天）
 * - UTC 时间（尾随 Z）：按 UTC 解析后再转本地墙钟（星期按本地星期推算）
 * - 带 TZID 参数时调用方已剥离参数只剩值：无法精确换算时按浮动时间处理并由调用方 warning（不静默差一天）
 */
function parseICSDateTime(value: string): { date: Date; time: string; isUTC: boolean } | null {
  const raw = value.trim();
  const isUTC = /[zZ]$/.test(raw);
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?[zZ]?$/.exec(raw);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (m[4] !== undefined) {
    const hh = m[4];
    const mm = m[5];
    if (isUTC) {
      const utc = new Date(Date.UTC(y, mo, d, Number(hh), Number(mm), Number(m[6] ?? "0")));
      const time = `${String(utc.getHours()).padStart(2, "0")}:${String(utc.getMinutes()).padStart(2, "0")}`;
      return { date: utc, time, isUTC: true };
    }
    const date = new Date(y, mo, d, Number(hh), Number(mm));
    return { date, time: `${hh}:${mm}`, isUTC: false };
  }
  const date = new Date(y, mo, d);
  return { date, time: "", isUTC: false };
}

/** date-fns 风格：周一=1 ... 周日=7（本地星期；UTC 事件已在解析时转本地） */
function dateToDayOfWeek(date: Date): number {
  const dow = date.getDay();
  return dow === 0 ? 7 : dow;
}

const ICS_BYDAY_MAP: Record<string, number> = {
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
  SU: 7,
};

function parseRRULE(value: string): Record<string, string> {
  const params: Record<string, string> = {};
  value.split(";").forEach((part) => {
    const eq = part.indexOf("=");
    if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).toUpperCase();
  });
  return params;
}

function addMinutes(timeStr: string, minutes: number): string {
  const total = timeToMinutes(timeStr) ?? 0;
  // 归一化到 00:00–23:59（此前 23:xx + 100m 会生成 "24:xx" 非法时间入库）
  const m = ((total + minutes) % (24 * 60) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function parseICS(icsText: string): ParsedImportResult {
  const courses: Course[] = [];
  const schedules: CourseSchedule[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  const lines = unfoldICSLines(icsText);
  const courseMap = new Map<string, Course>();

  const eventBlocks: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (/^BEGIN:VEVENT$/i.test(line)) {
      current = [];
    } else if (/^END:VEVENT$/i.test(line)) {
      if (current.length > 0) eventBlocks.push(current);
      current = [];
    } else if (current) {
      current.push(line);
    }
  }

  if (eventBlocks.length === 0) {
    errors.push("未找到有效的日历事件");
    return { courses, schedules, warnings, errors };
  }

  eventBlocks.forEach((block, idx) => {
    const summaryProp = getProperty(block, "SUMMARY");
    if (!summaryProp || !summaryProp.value.trim()) {
      errors.push(`跳过第 ${idx + 1} 个无 SUMMARY 的日历事件`);
      return;
    }
    const name = summaryProp.value.trim();
    const location = getProperty(block, "LOCATION")?.value.trim() || "未指定";

    // --- 星期来源：优先 RRULE BYDAY，其次 DTSTART 真实日期 ---
    let dayOfWeek: number | null = null;
    let startTime = "08:00";

    const rruleProp = getProperty(block, "RRULE");
    if (rruleProp) {
      const rrule = parseRRULE(rruleProp.value);
      if (rrule.FREQ && rrule.FREQ !== "WEEKLY") {
        warnings.push(`《${name}》：RRULE 频率为 ${rrule.FREQ}（非 WEEKLY），无法可靠表示，已按每周重复导入`);
      }
      if (rrule.BYDAY) {
        const days = rrule.BYDAY.split(",");
        if (days.length > 1) {
          warnings.push(`《${name}》：RRULE BYDAY 包含多天 (${rrule.BYDAY})，当前模型仅支持单天，已按 ${days[0]} 导入`);
        }
        const mapped = ICS_BYDAY_MAP[days[0]];
        if (mapped) {
          dayOfWeek = mapped;
        } else {
          warnings.push(`《${name}》：无法识别的 BYDAY (${days[0]})，改用 DTSTART 日期推算星期`);
        }
      }
      if (rrule.INTERVAL && Number(rrule.INTERVAL) > 1) {
        warnings.push(`《${name}》：RRULE 每 ${rrule.INTERVAL} 周重复 (INTERVAL) 暂不支持，已按每周课程导入`);
      }
      if (rrule.UNTIL || rrule.COUNT) {
        warnings.push(`《${name}》：RRULE 包含 UNTIL/COUNT 结束限制，未应用，已按每周课程导入`);
      }
    } else {
      warnings.push(`《${name}》：未找到 RRULE 重复规则，已按每周课程导入（若为单次事件请确认）`);
    }

    const dtStartProp = getProperty(block, "DTSTART");
    if (dtStartProp) {
      // TZID 无法精确换算：按浮动墙钟导入并明确提示（此前静默按 UTC 推星期，可能差一天）
      if (/TZID=/i.test(dtStartProp.head)) {
        warnings.push(`《${name}》：DTSTART 含时区参数，已按日历墙钟时间导入（跨时区请核对星期）`);
      }
      const parsed = parseICSDateTime(dtStartProp.value);
      if (parsed) {
        if (dayOfWeek === null) {
          dayOfWeek = dateToDayOfWeek(parsed.date);
        }
        if (parsed.time) {
          startTime = parsed.time;
        } else {
          warnings.push(`《${name}》：DTSTART 为全天日期 (VALUE=DATE)，无具体时间，开始时间按 08:00 处理`);
        }
      } else {
        warnings.push(`《${name}》：无法解析 DTSTART (${dtStartProp.value})，星期暂按默认顺序推算`);
      }
    } else {
      warnings.push(`《${name}》：缺少 DTSTART，无法确定星期，暂按默认顺序推算`);
    }

    // Fallback 仅用于确实无法识别的情况，且必须提示用户
    if (dayOfWeek === null) {
      dayOfWeek = (idx % 5) + 1;
      warnings.push(`《${name}》：无法确定星期，暂按周${"一二三四五六日"[dayOfWeek - 1]}处理`);
    }

    // --- 结束时间 ---
    let endTime = "";
    const dtEndProp = getProperty(block, "DTEND");
    if (dtEndProp) {
      const parsed = parseICSDateTime(dtEndProp.value);
      if (parsed && parsed.time) {
        endTime = parsed.time;
      } else {
        warnings.push(`《${name}》：无法解析 DTEND，结束时间按开始时间 +1h40m 推算`);
      }
    } else {
      warnings.push(`《${name}》：缺少 DTEND，结束时间按开始时间 +1h40m 推算`);
    }
    if (!endTime) endTime = addMinutes(startTime, 100);

    const exdateProp = getProperty(block, "EXDATE");
    if (exdateProp) {
      warnings.push(`《${name}》：检测到 EXDATE 停课日期，当前模型不支持排除，未应用`);
    }

    let course = courseMap.get(name);
    if (!course) {
      // Date.now()+idx 高频导入易碰撞 → randomUUID（同文件多事件同毫秒此前会覆盖）
      const uid = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : `${Date.now().toString(36)}${idx}`;
      course = {
        id: `c_ics_${uid}_${idx}`,
        name,
        code: `ICS-${100 + idx}`,
        teacher: "教务教师",
        classroom: location,
        credit: 3,
        bgHex: "#E3E6E0",
        borderHex: "#D0D5CC",
        textHex: "#313032",
        description: "通过 iCal (.ics) 文件导入的学期课程",
        materials: [],
      };
      courseMap.set(name, course);
      courses.push(course);
    }

    schedules.push({
      id: `s_ics_${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : `${Date.now().toString(36)}${idx}`}_${idx}`,
      courseId: course.id,
      dayOfWeek,
      startTime,
      endTime,
      location,
      weeks: "1-16周",
    });
  });

  return { courses, schedules, warnings, errors };
}

// ---------- CSV / 文本表格 ----------

/** 标准 CSV 引号字段解析："国际贸易,专题研究" 保持为单个字段，"" 转义 */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

const CSV_HEADER_KEYWORDS = ["课程", "教师", "教室", "学分", "星期", "开始时间", "结束时间", "周次"];

function isCSVHeaderLine(line: string): boolean {
  if (line.includes("星期") || line.includes("开始时间") || line.includes("结束时间")) return true;
  const hits = CSV_HEADER_KEYWORDS.filter((k) => line.includes(k));
  return hits.length >= 2;
}

export function parseCSVSchedule(csvText: string): ParsedImportResult {
  const courses: Course[] = [];
  const schedules: CourseSchedule[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  const lines = csvText
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  lines.forEach((line, idx) => {
    const lineLabel = `第 ${idx + 1} 行`;
    if (idx === 0 && isCSVHeaderLine(line)) return;

    const parts = parseCSVLine(line);
    if (parts.length < 2) {
      errors.push(`${lineLabel}: 字段数不足，已跳过`);
      return;
    }

    const [rawName, code, teacher, classroom, rawCredit, rawDay, rawStart, rawEnd, weeks] = parts;
    const name = rawName.trim();

    if (!name) {
      errors.push(`${lineLabel}: 课程名称为空，已跳过`);
      return;
    }

    const dayOfWeek = Number(rawDay);
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7) {
      errors.push(`${lineLabel}: 星期必须为 1-7（当前值 "${rawDay}"），已跳过`);
      return;
    }

    const startTime = (rawStart || "").trim();
    const endTime = (rawEnd || "").trim();
    if (!isValidTimeRange(startTime, endTime)) {
      errors.push(`${lineLabel}: 时间格式不正确或结束时间早于开始时间（${startTime} - ${endTime}），已跳过`);
      return;
    }

    const credit = Number(rawCredit);
    const courseId = `c_csv_${Date.now()}_${idx}`;

    courses.push({
      id: courseId,
      name,
      code: (code || "").trim() || `CSV-${300 + idx}`,
      teacher: (teacher || "").trim() || "未知教师",
      classroom: (classroom || "").trim() || "未指定",
      credit: Number.isFinite(credit) && credit > 0 ? credit : 3,
      bgHex: "#CCCBC4",
      borderHex: "#B8B7B0",
      textHex: "#313032",
      description: "从 CSV / 文本表格导入的课程",
      materials: [],
    });

    schedules.push({
      id: `s_csv_${Date.now()}_${idx}`,
      courseId,
      dayOfWeek,
      startTime,
      endTime,
      location: (classroom || "").trim() || "未指定",
      weeks: (weeks || "").trim() || "1-16周",
    });
  });

  if (courses.length === 0 && errors.length > 0) {
    warnings.push("没有识别到课程，请检查文件格式");
  }

  return { courses, schedules, warnings, errors };
}

// ---------- JSON ----------

export function parseJSONSchedule(jsonText: string): ParsedImportResult {
  const courses: Course[] = [];
  const schedules: CourseSchedule[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  let raw: any;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    errors.push("JSON 格式不正确，无法解析");
    return { courses, schedules, warnings, errors };
  }

  const items = Array.isArray(raw) ? raw : [raw];

  items.forEach((item: any, idx: number) => {
    const itemLabel = `第 ${idx + 1} 条`;
    const name = String(item.name || item.title || item.courseName || "").trim();

    if (!name) {
      errors.push(`${itemLabel}: 课程名称为空，已跳过`);
      return;
    }

    const dayOfWeek = Number(item.dayOfWeek);
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7) {
      errors.push(`${itemLabel}: 星期必须为 1-7（当前值 "${item.dayOfWeek}"），已跳过`);
      return;
    }

    const startTime = String(item.startTime || "").trim();
    const endTime = String(item.endTime || "").trim();
    if (!isValidTimeRange(startTime, endTime)) {
      errors.push(`${itemLabel}: 时间格式不正确或结束时间早于开始时间（${startTime} - ${endTime}），已跳过`);
      return;
    }

    const courseId = `c_json_${Date.now()}_${idx}`;

    courses.push({
      id: courseId,
      name,
      code: String(item.code || `JSON-${200 + idx}`).trim(),
      teacher: String(item.teacher || "未知教师").trim(),
      classroom: String(item.classroom || item.location || "未指定").trim(),
      credit: Number(item.credit) || 3,
      bgHex: item.bgHex || "#F0EBE1",
      borderHex: item.borderHex || "#E0D7C6",
      textHex: "#313032",
      description: String(item.description || "从 JSON 文件导入的课程").trim(),
      materials: [],
    });

    schedules.push({
      id: `s_json_${Date.now()}_${idx}`,
      courseId,
      dayOfWeek,
      startTime,
      endTime,
      location: String(item.location || courses[courses.length - 1].classroom || "未指定").trim(),
      weeks: String(item.weeks || "1-16周").trim(),
    });
  });

  if (courses.length === 0 && errors.length > 0) {
    warnings.push("没有识别到课程，请检查 JSON 字段");
  }

  return { courses, schedules, warnings, errors };
}
