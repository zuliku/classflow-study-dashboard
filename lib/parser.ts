import { Course, CourseSchedule } from "@/types";

export interface ParsedImportResult {
  courses: Course[];
  schedules: CourseSchedule[];
  errors: string[];
}

// 1. iCal (.ics) Parser
export function parseICS(icsText: string): ParsedImportResult {
  const courses: Course[] = [];
  const schedules: CourseSchedule[] = [];
  const errors: string[] = [];

  try {
    const events = icsText.split("BEGIN:VEVENT");
    if (events.length <= 1) {
      return { courses, schedules, errors: ["未检测到有效的 VEVENT 日历事件结构"] };
    }

    const courseMap = new Map<string, Course>();

    events.slice(1).forEach((evt, idx) => {
      const summaryMatch = evt.match(/SUMMARY:(.*)/i);
      const locationMatch = evt.match(/LOCATION:(.*)/i);
      const dtStartMatch = evt.match(/DTSTART[:;](.*)/i);
      const dtEndMatch = evt.match(/DTEND[:;](.*)/i);

      if (!summaryMatch) return;

      const name = summaryMatch[1].trim();
      const location = locationMatch ? locationMatch[1].trim() : "教二 201";

      let dayOfWeek = (idx % 5) + 1; // Fallback day of week
      let startTime = "08:00";
      let endTime = "09:40";

      if (dtStartMatch) {
        const val = dtStartMatch[1].trim().split(":").pop() || "";
        if (val.length >= 13) {
          const hours = val.substring(9, 11);
          const mins = val.substring(11, 13);
          startTime = `${hours}:${mins}`;
        }
      }

      if (dtEndMatch) {
        const val = dtEndMatch[1].trim().split(":").pop() || "";
        if (val.length >= 13) {
          const hours = val.substring(9, 11);
          const mins = val.substring(11, 13);
          endTime = `${hours}:${mins}`;
        }
      }

      let course = courseMap.get(name);
      if (!course) {
        const courseId = `c_ics_${Date.now()}_${idx}`;
        course = {
          id: courseId,
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
  } catch (e: any) {
    errors.push(`iCal 解析错误: ${e?.message || "格式不匹配"}`);
  }

  return { courses, schedules, errors };
}

// 2. JSON Parser
export function parseJSONSchedule(jsonText: string): ParsedImportResult {
  const courses: Course[] = [];
  const schedules: CourseSchedule[] = [];
  const errors: string[] = [];

  try {
    const raw = JSON.parse(jsonText);
    const items = Array.isArray(raw) ? raw : [raw];

    items.forEach((item: any, idx: number) => {
      const name = item.name || item.title || item.courseName || `导入课程 ${idx + 1}`;
      const courseId = `c_json_${Date.now()}_${idx}`;

      const newCourse: Course = {
        id: courseId,
        name,
        code: item.code || `JSON-${200 + idx}`,
        teacher: item.teacher || "未知教师",
        classroom: item.classroom || item.location || "教二 101",
        credit: Number(item.credit) || 3,
        bgHex: item.bgHex || "#F0EBE1",
        borderHex: item.borderHex || "#E0D7C6",
        textHex: "#313032",
        description: item.description || "JSON 模版一键导入课程",
        materials: [],
      };
      courses.push(newCourse);

      schedules.push({
        id: `s_json_${Date.now()}_${idx}`,
        courseId,
        dayOfWeek: Number(item.dayOfWeek) || ((idx % 5) + 1),
        startTime: item.startTime || "10:00",
        endTime: item.endTime || "11:40",
        location: item.location || newCourse.classroom,
        weeks: item.weeks || "1-16周",
      });
    });
  } catch (e: any) {
    errors.push(`JSON 格式解析错误: 请检查 JSON 语法是否有误`);
  }

  return { courses, schedules, errors };
}

// 3. CSV / Text Parser
export function parseCSVSchedule(csvText: string): ParsedImportResult {
  const courses: Course[] = [];
  const schedules: CourseSchedule[] = [];
  const errors: string[] = [];

  try {
    const lines = csvText.split("\n").map((l) => l.trim()).filter(Boolean);

    lines.forEach((line, idx) => {
      // Ignore header row if starts with 课程
      if (idx === 0 && line.includes("课程")) return;

      const parts = line.split(/[,,\t]/).map((p) => p.trim());
      if (parts.length < 2) return;

      const name = parts[0];
      const code = parts[1] || `CSV-${300 + idx}`;
      const teacher = parts[2] || "张老师";
      const classroom = parts[3] || "教一 201";
      const credit = Number(parts[4]) || 3;
      const dayOfWeek = Number(parts[5]) || ((idx % 5) + 1);
      const startTime = parts[6] || "08:00";
      const endTime = parts[7] || "09:40";
      const weeks = parts[8] || "1-16周";

      const courseId = `c_csv_${Date.now()}_${idx}`;

      courses.push({
        id: courseId,
        name,
        code,
        teacher,
        classroom,
        credit,
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
        location: classroom,
        weeks,
      });
    });
  } catch (e: any) {
    errors.push(`CSV 解析错误: ${e?.message || "数据格式错误"}`);
  }

  return { courses, schedules, errors };
}
