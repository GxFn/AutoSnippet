export interface Snippet {
  identifier: string;
  title: string;
  completionKey: string;
  summary: string;
  category?: string;
  language: string;
  content: string[];
  body?: string[];
  headers?: string[];
  /** 每条 header 相对于 target 根目录的路径，用于 // as:include <M/H.h> [path] */
  headerPaths?: string[];
  /** target/模块名，用于角括号格式 // as:include <TargetName/Header.h> */
  moduleName?: string;
  includeHeaders?: boolean;
  link?: string;
}

export interface Skill {
  name: string;
  content: string;
  metadata?: any;
}

export interface ProjectData {
  rootSpec: {
    list: Snippet[];
    skills?: {
      dir: string;
    };
  };
  skills: Skill[];
  candidates: Record<string, {
    targetName: string;
    scanTime: number;
    items: (ExtractedSkill & { id: string; status: string })[];
  }>;
  projectRoot: string;
  watcherStatus?: string;
}

export interface SPMTarget {
  name: string;
  packageName: string;
  packagePath: string;
  targetDir: string;
  info: any;
}

export interface ExtractedSkill {
  title: string;
  summary: string;
  summary_cn?: string;
  summary_en?: string;
  trigger: string;
  category?: string;
  language: string;
  code: string;
  usageGuide: string;
  usageGuide_cn?: string;
  usageGuide_en?: string;
  headers?: string[];
  /** 每条 header 相对于 target 根目录的路径，与 create/headName 一致，用于 // as:include <M/H.h> [path] */
  headerPaths?: string[];
  /** target/模块名，用于角括号格式 // as:include <TargetName/Header.h> */
  moduleName?: string;
  /** 是否引入头文件：true 时 snippet 内写入 // as:include 标记，watch 按标记注入依赖 */
  includeHeaders?: boolean;
}
