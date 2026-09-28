import type { KiroContextRef } from "@/lib/ai/context/types";

/**
 * ClassFlow Context 选项（KiroContextListView 与 @ mention 菜单共用，唯一数据源）。
 * 从 Store 实体派生分组（课程 / 任务 / 时间范围 / 小组项目 / 课程资料）；
 * 纯函数（无 DOM / 无 Store），展示上限与 ListView 历史行为一致。
 */

export interface KiroContextGroup {
  title: string;
  items: KiroContextRef[];
}

interface CourseLike {
  id: string;
  name: string;
  teacher?: string;
  materials: { id: string; title: string; type: string }[];
}

interface AssignmentLike {
  id: string;
  title: string;
  courseId?: string;
}

interface GroupProjectLike {
  id: string;
  title: string;
  courseId?: string;
}

export function getKiroContextGroups(
  courses: readonly CourseLike[],
  assignments: readonly AssignmentLike[],
  groupProjects: readonly GroupProjectLike[]
): KiroContextGroup[] {
  return [
    {
      title: "课程",
      items: courses.slice(0, 8).map((c) => ({
        key: `manual-course-${c.id}`,
        kind: "course" as const,
        entityId: c.id,
        label: `${c.name}${c.teacher ? `（${c.teacher}）` : ""}`,
        source: "manual" as const,
      })),
    },
    {
      title: "任务",
      items: assignments.slice(0, 8).map((a) => {
        const course = courses.find((c) => c.id === a.courseId);
        return {
          key: `manual-assignment-${a.id}`,
          kind: "assignment" as const,
          entityId: a.id,
          label: `${a.title}${course ? ` · ${course.name}` : ""}`,
          source: "manual" as const,
        };
      }),
    },
    {
      title: "时间范围",
      items: [
        { key: "manual-week-current", kind: "week" as const, entityId: "current", label: "本周", source: "manual" as const },
        { key: "manual-week-next", kind: "week" as const, entityId: "next", label: "下周", source: "manual" as const },
      ],
    },
    {
      title: "小组项目",
      items: groupProjects.slice(0, 6).map((p) => {
        const course = courses.find((c) => c.id === p.courseId);
        return {
          key: `manual-project-${p.id}`,
          kind: "group-project" as const,
          entityId: p.id,
          label: `${p.title}${course ? ` · ${course.name}` : ""}`,
          source: "manual" as const,
        };
      }),
    },
    {
      title: "课程资料",
      items: courses
        .flatMap((c) =>
          c.materials.map((m) => ({
            key: `manual-material-${m.id}`,
            kind: "material" as const,
            entityId: m.id,
            label: `${m.title} · ${c.name}`,
            source: "manual" as const,
          }))
        )
        .slice(0, 8),
    },
  ].filter((g) => g.items.length > 0);
}
