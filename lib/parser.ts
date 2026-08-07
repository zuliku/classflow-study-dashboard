import { Course, CourseSchedule } from "@/types";

export interface ParsedImportResult {
  courses: Course[];
  schedules: CourseSchedule[];
  warnings: string[];
  errors: string[];
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function timeToMinutes(timeStr: string): number | null {
  const m = TIME_RE.exec(timeStr);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function isValidTimeRange(startTime: string, endTime: string): boolean {
  const s = timeToMinutes(startTime);
  const e = timeToMinutes(endTime);
  return s !== null && e !== null && e > s;
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

/** 解析 DTSTART / DTEND 的常见形式（本地时间或 DTSTART;TZID=...: 形式） */
function parseICSDateTime(value: string): { date: Date; time: string } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?$/.exec(value.trim());
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (m[4] !== undefined) {
    return { date, time: `${m[4]}:${m[5]}` };
  }
  return { date, time: "" };
}

/** date-fns 风格：周一=1 ... 周日=7 */
function dateToDayOfWeek(date: Date): number {
  return date.getUTCDay() === 0 ? 7 : date.getUTCDay();
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
  const m = total + minutes;
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
    errors.push("未检测到有效的 VEVENT 日历事件结构");
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
        warnings.push(`「${name}」: RRULE 频率为 ${rrule.FREQ}（非 WEEKLY），无法可靠表示，已按每周重复导入`);
      }
      if (rrule.BYDAY) {
        const days = rrule.BYDAY.split(",");
        if (days.length > 1) {
          warnings.push(`「${name}」: RRULE BYDAY 包含多天 (${rrule.BYDAY})，当前模型仅支持单天，已按 ${days[0]} 导入`);
        }
        const mapped = ICS_BYDAY_MAP[days[0]];
        if (mapped) {
          dayOfWeek = mapped;
        } else {
          warnings.push(`「${name}」: 无法识别的 BYDAY (${days[0]})，改用 DTSTART 日期推算星期`);
        }
      }
      if (rrule.INTERVAL && Number(rrule.INTERVAL) > 1) {
        warnings.push(`「${name}」: RRULE 每 ${rrule.INTERVAL} 周重复 (INTERVAL) 暂不支持，已按每周例行课导入`);
      }
      if (rrule.UNTIL || rrule.COUNT) {
        warnings.push(`「${name}」: RRULE 包含 UNTIL/COUNT 结束限制，未应用，已按每周例行课导入`);
      }
    } else {
      warnings.push(`「${name}」: 未检测到 RRULE 重复规则，已按每周例行课程导入（如为单次事件请确认）`);
    }

    const dtStartProp = getProperty(block, "DTSTART");
    if (dtStartProp) {
      const parsed = parseICSDateTime(dtStartProp.value);
      if (parsed) {
        if (dayOfWeek === null) {
          dayOfWeek = dateToDayOfWeek(parsed.date);
        }
        if (parsed.time) {
          startTime = parsed.time;
        } else {
          warnings.push(`「${name}」: DTSTART 为全天日期 (VALUE=DATE)，无具体时间，开始时间按 08:00 处理`);
        }
      } else {
        warnings.push(`「${name}」: 无法解析 DTSTART (${dtStartProp.value})，星期按默认顺序推算`);
      }
    } else {
      warnings.push(`「${name}」: 缺少 DTSTART，无法确定真实星期，按默认顺序推算`);
    }

    // Fallback 仅用于确实无法识别的情况，且必须提示用户
    if (dayOfWeek === null) {
      dayOfWeek = (idx % 5) + 1;
      warnings.push(`「${name}」: 无法从文件确定星期，已按周${"一二三四五六日"[dayOfWeek - 1]}（第 ${idx + 1} 个事件顺序）推算`);
    }

    // --- 结束时间 ---
    let endTime = "";
    const dtEndProp = getProperty(block, "DTEND");
    if (dtEndProp) {
      const parsed = parseICSDateTime(dtEndProp.value);
      if (parsed && parsed.time) {
        endTime = parsed.time;
      } else {
        warnings.push(`「${name}」: 无法解析 DTEND，结束时间按开始时间 +1h40m 推算`);
      }
    } else {
      warnings.push(`「${name}」: 缺少 DTEND，结束时间按开始时间 +1h40m 推算`);
    }
    if (!endTime) endTime = addMinutes(startTime, 100);

    const exdateProp = getProperty(block, "EXDATE");
    if (exdateProp) {
      warnings.push(`「${name}」: 检测到 EXDATE 停课日期，当前模型不支持排除，未应用`);
    }

    let course = courseMap.get(name);
    if (!course) {
      course = {
        id: `c_ics_${Date.now()}_${idx}`,
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
      id: `s_ics_${Date.now()}_${idx}`,
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
      errors.push(`${lineLabel}: 时间格式非法或结束时间不晚于开始时间（${startTime} - ${endTime}），已跳过`);
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
    warnings.push("没有成功解析到课程，请检查文件格式是否符合表格模板");
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
    errors.push("JSON 语法错误，无法解析");
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
      errors.push(`${itemLabel}: 时间格式非法或结束时间不晚于开始时间（${startTime} - ${endTime}），已跳过`);
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
      description: String(item.description || "JSON 模版一键导入课程").trim(),
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
    warnings.push("没有成功解析到课程，请检查 JSON 字段是否完整");
  }

  return { courses, schedules, warnings, errors };
}
