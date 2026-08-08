import { AppPreferences, Priority, DefaultTaskStatus } from "@/types";

/** 新建任务的默认值（优先级/状态/截止时刻），所有新建入口共用同一来源 */
export interface NewTaskDefaults {
  priority: Priority;
  status: DefaultTaskStatus;
  ddlTime: string;
}

/** 从偏好导出新建任务默认值；编辑已有任务绝不使用本函数（走任务自身字段） */
export function getNewTaskDefaults(preferences: AppPreferences): NewTaskDefaults {
  return {
    priority: preferences.defaultTaskPriority,
    status: preferences.defaultTaskStatus,
    ddlTime: preferences.defaultDDLTime,
  };
}
