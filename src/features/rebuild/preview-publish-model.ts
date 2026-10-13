/** The Vercel preview stage, when blocked, offers force-deploy, re-check, and mark-as-deployed. */
export function previewPublishOverridesVisible(stage: { id: string; status: string }): boolean {
  return stage.id === "preview" && stage.status === "blocked";
}
