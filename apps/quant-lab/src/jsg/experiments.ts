export interface ResearchProject {
  id: string;
  name: string;
  createdAt: string;
}
export interface ResearchExperiment {
  id: string;
  projectId: string;
  name: string;
  notes: string;
  tags: string[];
  favorite: boolean;
  baselineId: string | null;
  createdAt: string;
}
export const DEFAULT_PROJECT_ID = "project-main";
export const DEFAULT_EXPERIMENT_ID = "experiment-main";
export function initialLibrary() {
  const createdAt = new Date().toISOString();
  return {
    projects: [{ id: DEFAULT_PROJECT_ID, name: "我的研究", createdAt }],
    experiments: [
      {
        id: DEFAULT_EXPERIMENT_ID,
        projectId: DEFAULT_PROJECT_ID,
        name: "策略探索",
        notes: "",
        tags: [],
        favorite: false,
        baselineId: null,
        createdAt,
      },
    ],
    experimentId: DEFAULT_EXPERIMENT_ID,
  };
}
export function experimentText(experiment: ResearchExperiment) {
  return [experiment.name, experiment.notes, ...experiment.tags].join(" ").toLocaleLowerCase();
}
export function validateLibrary(
  projects: ResearchProject[],
  experiments: ResearchExperiment[],
  experimentId: string,
) {
  if (
    !Array.isArray(projects) ||
    !projects.length ||
    projects.length > 100 ||
    !Array.isArray(experiments) ||
    !experiments.length ||
    experiments.length > 1000
  )
    throw new Error("研究目录格式无效");
  const projectIds = new Set<string>(),
    ids = new Set<string>();
  for (const p of projects) {
    if (
      typeof p.id !== "string" ||
      !p.id ||
      projectIds.has(p.id) ||
      typeof p.name !== "string" ||
      !p.name.trim() ||
      p.name.length > 120 ||
      !Number.isFinite(Date.parse(p.createdAt))
    )
      throw new Error("研究项目格式无效");
    projectIds.add(p.id);
  }
  for (const e of experiments) {
    if (
      typeof e.id !== "string" ||
      !e.id ||
      ids.has(e.id) ||
      !projectIds.has(e.projectId) ||
      typeof e.name !== "string" ||
      !e.name.trim() ||
      e.name.length > 120 ||
      typeof e.notes !== "string" ||
      e.notes.length > 10000 ||
      typeof e.favorite !== "boolean" ||
      !Array.isArray(e.tags) ||
      e.tags.length > 20 ||
      e.tags.some((t) => typeof t !== "string" || t.length > 40) ||
      !Number.isFinite(Date.parse(e.createdAt)) ||
      (e.baselineId !== null && typeof e.baselineId !== "string")
    )
      throw new Error("研究实验格式无效");
    ids.add(e.id);
  }
  if (!ids.has(experimentId)) throw new Error("当前研究实验不存在");
}
