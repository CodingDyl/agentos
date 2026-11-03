/** The brief's text fields, as the person typed them. */
export function readBrief(form: FormData) {
  const text = (name: string) => String(form.get(name) ?? "").trim();
  return {
    websiteUrl: text("websiteUrl"),
    targetMarket: text("targetMarket"),
    location: text("location"),
    conversionGoal: text("conversionGoal"),
    designTemplate: text("designTemplate") || "DESIGN.md",
  };
}

export const companyOf = (form: FormData) => String(form.get("company") ?? "").trim();
